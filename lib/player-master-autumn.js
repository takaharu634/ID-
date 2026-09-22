// Verified against official university rosters on 2026-09-11.
// Additions supplement the historical spreadsheet master without replacing it.
export const AUTUMN_PLAYER_NAMES = [
  {
    "team": "中央大学",
    "teamCodes": [
      "CHU_UNI"
    ],
    "kanji": "平山 颯士",
    "roman": "Hirayama, Soshi",
    "aliases": [
      "Hirayama, Soshi"
    ],
    "sources": [
      "https://chuobaseballteam.wixsite.com/chuobaseball/複製-投手紹介"
    ]
  },
  {
    "team": "中央大学",
    "teamCodes": [
      "CHU_UNI"
    ],
    "kanji": "松嶋 祥斗",
    "roman": "Matsushima, Shoto",
    "aliases": [
      "Matsushima, Shoto"
    ],
    "sources": [
      "https://chuobaseballteam.wixsite.com/chuobaseball/複製-捕手紹介"
    ]
  },
  {
    "team": "中央大学",
    "teamCodes": [
      "CHU_UNI"
    ],
    "kanji": "下山 大楽",
    "roman": "Shimoyama, Taira",
    "aliases": [
      "Shimoyama, Taira"
    ],
    "sources": [
      "https://chuobaseballteam.wixsite.com/chuobaseball/複製-外野手紹介"
    ]
  },
  {
    "team": "中央大学",
    "teamCodes": [
      "CHU_UNI"
    ],
    "kanji": "山田 晃太郎",
    "roman": "Yamada, Kotaro",
    "aliases": [
      "Yamada, Kotaro"
    ],
    "sources": [
      "https://chuobaseballteam.wixsite.com/chuobaseball/複製-投手紹介"
    ]
  },
  {
    "team": "中央大学",
    "teamCodes": [
      "CHU_UNI"
    ],
    "kanji": "横谷 塁",
    "roman": "Yokoya, Rui",
    "aliases": [
      "Yokoya, Rui"
    ],
    "sources": [
      "https://chuobaseballteam.wixsite.com/chuobaseball/複製-外野手紹介"
    ]
  },
  {
    "team": "青山学院大学",
    "teamCodes": [
      "AOY_UNI"
    ],
    "kanji": "金本 貫汰",
    "roman": "Kanemoto, Kanta",
    "aliases": [
      "Kanemoto, Kanta"
    ],
    "sources": [
      "https://www.agubbc.com/member/金本貫汰"
    ]
  },
  {
    "team": "青山学院大学",
    "teamCodes": [
      "AOY_UNI"
    ],
    "kanji": "村上 洸星",
    "roman": "Murakami, Kosei",
    "aliases": [
      "Murakami, Kosei"
    ],
    "sources": [
      "https://www.agubbc.com/member/村上　洸星"
    ]
  },
  {
    "team": "國學院大學",
    "teamCodes": [
      "KOK_UNI"
    ],
    "kanji": "中村 祐斗",
    "roman": "Nakamura, Yuto",
    "aliases": [
      "Nakamura, Yuto"
    ],
    "sources": [
      "https://kokugakuin-baseball.com/?post_type=member&s=中村"
    ]
  },
  {
    "team": "國學院大學",
    "teamCodes": [
      "KOK_UNI"
    ],
    "kanji": "篠本 賢伸",
    "roman": "Sasamoto, Kenshin",
    "aliases": [
      "Sasamoto, Kenshin"
    ],
    "sources": [
      "https://kokugakuin-baseball.com/member/"
    ]
  },
  {
    "team": "東洋大学",
    "teamCodes": [
      "TOY_UNI"
    ],
    "kanji": "大城戸 陸琥",
    "roman": "Okido, Riku",
    "aliases": [
      "Okido, Riku"
    ],
    "sources": [
      "https://toyouniv.wixsite.com/tohto/複製-新しいページ-1"
    ]
  },
  {
    "team": "東洋大学",
    "teamCodes": [
      "TOY_UNI"
    ],
    "kanji": "大坪 廉",
    "roman": "Otsubo, Ren",
    "aliases": [
      "Otsubo, Ren"
    ],
    "sources": [
      "https://toyouniv.wixsite.com/tohto/大坪廉"
    ]
  },
  {
    "team": "東洋大学",
    "teamCodes": [
      "TOY_UNI"
    ],
    "kanji": "八巻 弓真",
    "roman": "Yamaki, Yuma",
    "aliases": [
      "Yamaki, Yuma"
    ],
    "sources": [
      "https://toyouniv.wixsite.com/tohto/複製-複製-長島-光来"
    ]
  },
  {
    "team": "立正大学",
    "teamCodes": [
      "RIS_UNI"
    ],
    "kanji": "三浦 天和",
    "roman": "Miura, Tento",
    "aliases": [
      "Miura, Tento"
    ],
    "sources": [
      "https://www.ris.ac.jp/sports/baseball/memberlist/index.html",
      "https://www.ris.ac.jp/sports/baseball/memberlist/baseball.json"
    ]
  }
];

const personKey = player => `${player.team}|${player.kanji.replace(/\s/g, '')}`;

export function withAutumnPlayerNames(base) {
  const result = base.map(player => ({ ...player }));
  for (const addition of AUTUMN_PLAYER_NAMES) {
    const existing = result.find(player => personKey(player) === personKey(addition));
    if (existing) {
      // Keep the prior canonical Roman name; accept the new TrackMan spelling.
      existing.aliases = [...new Set([existing.roman, ...(existing.aliases ?? []), addition.roman, ...addition.aliases])];
      existing.sources = [...new Set([...(existing.sources ?? []), ...addition.sources])];
    } else {
      result.push({ ...addition });
    }
  }
  return result;
}
