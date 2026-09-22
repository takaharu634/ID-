"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { playUiSound } from "../ui-sound";

type Metadata = {
  season: string;
  sourceName: string;
  pitches: number;
  games: number;
  teams: number;
  battedBalls: number;
};

type Dataset = {
  metadata: Metadata;
};

type ImportRow = {
  id: string;
  fileName: string;
  uploadedAt: string;
  pitchCount: number;
  isActive: boolean;
};

type UploadStatus = {
  kind: "idle" | "working" | "success" | "error";
  message: string;
};

export default function AdminApp({ displayName }: { displayName: string }) {
  const [data, setData] = useState<Dataset | null>(null);
  const [season, setSeason] = useState("2026年秋季");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState<UploadStatus>({ kind: "idle", message: "" });
  const [muted, setMuted] = useState(false);

  async function loadDataset() {
    const initialResponse = await fetch("/data/initial-data.json");
    if (!initialResponse.ok) throw new Error("初期データを読み込めませんでした。");
    let selected = await initialResponse.json() as Dataset;
    const currentResponse = await fetch("/api/dataset", { cache: "no-store" });
    if (currentResponse.ok && currentResponse.status !== 204) {
      selected = await currentResponse.json() as Dataset;
    }
    setData(selected);
    setSeason((current) => current === "2026年秋季" ? selected.metadata.season : current);
  }

  async function loadImports() {
    const response = await fetch("/api/imports", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "追加履歴を読み込めませんでした。");
    setImports(result.imports ?? []);
  }

  async function refresh() {
    try {
      await Promise.all([loadDataset(), loadImports()]);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "管理データを読み込めませんでした。");
    }
  }

  useEffect(() => {
    refresh();
    setMuted(window.localStorage.getItem("tohto-savant-muted") === "true");
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setStatus({ kind: "error", message: "CSVファイルを選択してください。" });
      return;
    }

    setStatus({ kind: "working", message: "CSVを検証し、指標を再計算しています。" });
    const form = new FormData();
    form.set("file", file);
    form.set("season", season);

    try {
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "追加に失敗しました。");
      setStatus({ kind: "success", message: result.message });
      playUiSound("success", muted);
      setFile(null);
      setFileInputKey((current) => current + 1);
      await refresh();
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "追加に失敗しました。" });
    }
  }

  return (
    <div className="site-shell">
      <header className="admin-simple-header">
        <Link className="admin-brand-link" href="/">ID東都</Link>
        <div className="admin-account">
          <button className="sound-button" onClick={() => { const next=!muted; setMuted(next); window.localStorage.setItem("tohto-savant-muted",String(next)); if (!next) playUiSound("pop", false); }} aria-label={muted?"効果音をオンにする":"効果音をオフにする"}>{muted?"🔇":"🔊"}</button>
          <span>{displayName}</span>
          <a href="/signout-with-chatgpt?return_to=%2F">サインアウト</a>
        </div>
      </header>

      <main className="page-wrap">
        <section className="page-section">
          <header className="page-heading">
            <p>管理者限定</p>
            <h1>CSVデータ管理</h1>
            <span>TrackManのCSVを追加すると、重複除去・球種統合・全指標の再計算を行い、公開サイトへ反映します。</span>
          </header>

          {loadError && <p className="upload-status error">{loadError}</p>}

          <div className="admin-grid">
            <form className="upload-card" onSubmit={submit}>
              <h2>新しいデータを追加</h2>
              <label>
                大会・期間名
                <input value={season} onChange={(event) => setSeason(event.target.value)} placeholder="例：2026年秋季" />
              </label>
              <label className="drop-zone">
                <input key={fileInputKey} type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                <span className="upload-icon">↑</span>
                <strong>{file ? file.name : "CSVを選択"}</strong>
                <small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "最大30MB・TrackMan CSV形式"}</small>
              </label>
              <button className="primary-button" type="submit" disabled={status.kind === "working"}>
                {status.kind === "working" ? "計算中…" : "検証して反映"}
              </button>
              {status.message && <p className={`upload-status ${status.kind}`}>{status.message}</p>}
            </form>

            <div className="current-data-card">
              <h2>現在公開中</h2>
              {data ? (
                <>
                  <strong>{data.metadata.season}</strong>
                  <p>{data.metadata.sourceName}</p>
                  <dl>
                    <div><dt>投球</dt><dd>{data.metadata.pitches.toLocaleString("ja-JP")}</dd></div>
                    <div><dt>試合</dt><dd>{data.metadata.games}</dd></div>
                    <div><dt>大学</dt><dd>{data.metadata.teams}</dd></div>
                    <div><dt>打球</dt><dd>{data.metadata.battedBalls.toLocaleString("ja-JP")}</dd></div>
                  </dl>
                  <a className="secondary-button download-link" href="/api/dataset?format=csv">現在のCSVを保存</a>
                </>
              ) : <p>データを読み込んでいます。</p>}
            </div>
          </div>

          <section className="import-history">
            <h2>追加履歴</h2>
            {imports.length ? imports.map((row) => (
              <div key={row.id}>
                <span className={row.isActive ? "active-file" : ""}>{row.isActive ? "公開中" : "保存済"}</span>
                <strong>{row.fileName}</strong>
                <small>{new Date(row.uploadedAt).toLocaleString("ja-JP")}・{row.pitchCount.toLocaleString("ja-JP")}球</small>
              </div>
            )) : <p>追加履歴はまだありません。初期データはサイトに同梱されています。</p>}
          </section>

          <div className="method-card">
            <h3>CSV反映ルール</h3>
            <ul>
              <li>球種は手入力値を優先し、「不明」のみ自動判定値で補完します。</li>
              <li>立正大学のコード「TAI_UNI」と「RIS_UNI」は同じ大学として統合します。</li>
              <li>球質指数+などは追加後の全データを基準100として再標準化します。</li>
              <li>TrackManにないバット速度、走者速度、守備範囲の項目は表示しません。</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
