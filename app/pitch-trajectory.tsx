"use client";

import { useEffect, useRef, useState } from "react";
import type { SeasonKey } from "../lib/dataset-types";
import manifest from "../lib/generated/trajectory-studio.json";

export default function PitchTrajectoryView({ season, pitchCount }: { season: SeasonKey; pitchCount: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [height, setHeight] = useState<number | undefined>();
  const available = manifest.seasons[season as keyof typeof manifest.seasons];

  useEffect(() => {
    if (!available) return;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!frame.current) return;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        setHeight(Math.max(240, Math.floor(viewportHeight - frame.current.getBoundingClientRect().top - 8)));
      });
    };
    const message = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "id-touto-trajectory-ready" && event.data.season === season) setState("ready");
    };
    const timeout = window.setTimeout(() => setState(current => current === "ready" ? current : "error"), 25000);
    window.addEventListener("message", message);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    const header = document.querySelector(".site-header");
    if (header) observer?.observe(header);
    fit();
    return () => {
      window.clearTimeout(timeout);
      cancelAnimationFrame(raf);
      window.removeEventListener("message", message);
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      observer?.disconnect();
    };
  }, [season, attempt, available]);

  if (!available) return <section className="trajectory-unavailable"><h1>投球軌道</h1><p>このシーズンの軌道データは未収録です。シーズンを切り替えてください。</p></section>;

  return <section className="pitch-trajectory-page" aria-label="投球軌道">
    {available.pitches !== pitchCount && <p className="trajectory-data-note" role="status">軌道は{available.lastDate}までの{available.pitches.toLocaleString()}球を表示しています。現在の集計データには追加・変更があり、軌道データへの反映が必要です。</p>}
    <div className="trajectory-frame-wrap">
      <iframe
        key={attempt}
        ref={frame}
        className="trajectory-frame"
        src={`/trajectory-studio/index.html?embedded=1&season=${encodeURIComponent(season)}&v=${manifest.sourceCommit}`}
        title="投球軌道スタジオ"
        allowFullScreen
        style={{ height }}
        onError={() => setState("error")}
      />
      {state !== "ready" && <div className="trajectory-load-status" role="status">
        <p>{state === "error" ? "投球画面を確認できませんでした。通信を確認して再試行してください。" : "投球画面を読み込んでいます…"}</p>
        {state === "error" && <button onClick={() => { setState("loading"); setAttempt(value => value + 1); }}>再試行</button>}
      </div>}
    </div>
  </section>;
}
