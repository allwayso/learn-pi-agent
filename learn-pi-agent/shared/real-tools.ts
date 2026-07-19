// shared/real-tools.ts — 真实 API 工具：天气 + Wikipedia
// 运行：npx tsx learn-pi-agent/shared/real-tools.ts（自检）

import { RegisteredTool } from "../stage2-tool-call/2.2-tool-registry"

// ─── 天气查询（Open-Meteo，免费无需 key）───

/** 城市名 → 经纬度（Open-Meteo Geocoding API） */
async function geocode(city: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`
  const res = await fetch(url)
  const json = await res.json()
  if (!json.results?.length) return null
  const r = json.results[0]
  return { lat: r.latitude, lon: r.longitude, name: r.name }
}

/** 天气代码 → 中文描述 */
function weatherDesc(code: number): string {
  if (code <= 1) return "晴"
  if (code <= 3) return "多云"
  if (code <= 48) return "雾/霾"
  if (code <= 57) return "毛毛雨"
  if (code <= 67) return "雨"
  if (code <= 77) return "雪"
  if (code <= 82) return "阵雨"
  if (code <= 86) return "阵雪"
  return "雷暴"
}

export const realWeatherTool: RegisteredTool = {
  name: "getWeather",
  description: "获取指定城市的实时天气（来源：Open-Meteo）",
  parameters: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "城市名称，如 北京、上海、Tokyo、London",
      },
    },
    required: ["city"],
  },
  execute: async (args) => {
    const geo = await geocode(args.city as string)
    if (!geo) return `未找到城市 "${args.city}"`

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`
    const res = await fetch(url)
    const json = await res.json()
    const c = json.current

    return [
      `${geo.name} 实时天气：`,
      `🌡 温度 ${c.temperature_2m}°C`,
      `💧 湿度 ${c.relative_humidity_2m}%`,
      `🌤 ${weatherDesc(c.weather_code)}`,
      `💨 风速 ${c.wind_speed_10m} km/h`,
    ].join("\n")
  },
}

// ─── Wikipedia 搜索（Wikimedia Core API，免费无需 key）───

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "")
}

export const wikipediaTool: RegisteredTool = {
  name: "searchWikipedia",
  description: "搜索 Wikipedia，获取词条摘要",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
    },
    required: ["query"],
  },
  execute: async (args) => {
    const query = encodeURIComponent(args.query as string)
    const url = `https://api.wikimedia.org/core/v1/wikipedia/en/search/page?q=${query}&limit=3`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)  // 8s 超时

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "LearnPiAgent/1.0" },
        signal: controller.signal,
      })
      const json = await res.json()
      const pages = json.pages || []

      if (!pages.length) return `未找到与 "${args.query}" 相关的 Wikipedia 词条`

      return pages.map((p: any) => {
        const excerpt = p.excerpt ? stripHtml(p.excerpt) : "无摘要"
        const desc = p.description ? `（${p.description}）` : ""
        return `📖 ${p.title}${desc}\n   ${excerpt.slice(0, 250)}`
      }).join("\n\n")
    } finally {
      clearTimeout(timer)
    }
  },
}

// ─── 自检 ───

async function main() {
  console.log("=== 天气 API 自检 ===")
  const w = await realWeatherTool.execute({ city: "北京" })
  console.log(w)

  console.log("\n=== Wikipedia API 自检 ===")
  const wiki = await wikipediaTool.execute({ query: "TypeScript" })
  console.log(wiki)
}

// 直接运行此文件时自检
if (process.argv[1]?.endsWith("real-tools.ts")) {
  main()
}
