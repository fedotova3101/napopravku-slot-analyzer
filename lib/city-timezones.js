const DEFAULT_TIMEZONE = "Europe/Moscow";

const CITY_TIMEZONES = new Map([
  ["abakan", "Asia/Krasnoyarsk"],
  ["anapa", "Europe/Moscow"],
  ["arkhangelsk", "Europe/Moscow"],
  ["astrakhan", "Europe/Astrakhan"],
  ["barnaul", "Asia/Barnaul"],
  ["belgorod", "Europe/Moscow"],
  ["bryansk", "Europe/Moscow"],
  ["cheboksary", "Europe/Moscow"],
  ["chelyabinsk", "Asia/Yekaterinburg"],
  ["chita", "Asia/Chita"],
  ["ekaterinburg", "Asia/Yekaterinburg"],
  ["irkutsk", "Asia/Irkutsk"],
  ["ivanovo", "Europe/Moscow"],
  ["izhevsk", "Europe/Samara"],
  ["kaliningrad", "Europe/Kaliningrad"],
  ["kaluga", "Europe/Moscow"],
  ["kazan", "Europe/Moscow"],
  ["kemerovo", "Asia/Novokuznetsk"],
  ["khabarovsk", "Asia/Vladivostok"],
  ["kirov", "Europe/Kirov"],
  ["krasnodar", "Europe/Moscow"],
  ["krasnoyarsk", "Asia/Krasnoyarsk"],
  ["kurgan", "Asia/Yekaterinburg"],
  ["kursk", "Europe/Moscow"],
  ["lipetsk", "Europe/Moscow"],
  ["magnitogorsk", "Asia/Yekaterinburg"],
  ["mahachkala", "Europe/Moscow"],
  ["moscow", "Europe/Moscow"],
  ["murmansk", "Europe/Moscow"],
  ["naberezhnye-chelny", "Europe/Moscow"],
  ["nizhnevartovsk", "Asia/Yekaterinburg"],
  ["nizhniy-novgorod", "Europe/Moscow"],
  ["novokuznetsk", "Asia/Novokuznetsk"],
  ["novorossiysk", "Europe/Moscow"],
  ["novosibirsk", "Asia/Novosibirsk"],
  ["omsk", "Asia/Omsk"],
  ["orel", "Europe/Moscow"],
  ["orenburg", "Asia/Yekaterinburg"],
  ["penza", "Europe/Moscow"],
  ["perm", "Asia/Yekaterinburg"],
  ["petrozavodsk", "Europe/Moscow"],
  ["pskov", "Europe/Moscow"],
  ["rostov-na-donu", "Europe/Moscow"],
  ["ryazan", "Europe/Moscow"],
  ["samara", "Europe/Samara"],
  ["saratov", "Europe/Saratov"],
  ["smolensk", "Europe/Moscow"],
  ["sochi", "Europe/Moscow"],
  ["spb", "Europe/Moscow"],
  ["stavropol", "Europe/Moscow"],
  ["surgut", "Asia/Yekaterinburg"],
  ["tambov", "Europe/Moscow"],
  ["tolyatti", "Europe/Samara"],
  ["tomsk", "Asia/Tomsk"],
  ["tula", "Europe/Moscow"],
  ["tver", "Europe/Moscow"],
  ["tyumen", "Asia/Yekaterinburg"],
  ["ufa", "Asia/Yekaterinburg"],
  ["ulan-ude", "Asia/Irkutsk"],
  ["ulyanovsk", "Europe/Ulyanovsk"],
  ["vladimir", "Europe/Moscow"],
  ["vladivostok", "Asia/Vladivostok"],
  ["volgograd", "Europe/Volgograd"],
  ["vologda", "Europe/Moscow"],
  ["voronezh", "Europe/Moscow"],
  ["yakutsk", "Asia/Yakutsk"],
  ["yaroslavl", "Europe/Moscow"],
  ["yuzhno-sakhalinsk", "Asia/Sakhalin"]
]);

export function resolveNapopravkuTimezone(value) {
  const citySlug = extractCitySlug(value);
  return CITY_TIMEZONES.get(citySlug) || DEFAULT_TIMEZONE;
}

export function dateLabelForOffset(timeZone, offset, now = new Date()) {
  const base = new Date(now);
  base.setUTCDate(base.getUTCDate() + Number(offset || 0));
  const parts = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    timeZone
  }).formatToParts(base);
  const day = parts.find(part => part.type === "day")?.value || "01";
  const month = parts.find(part => part.type === "month")?.value || "01";
  return `${day}.${month}`;
}

export function extractCitySlug(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== "napopravku.ru") {
      const subdomain = url.hostname.replace(/\.napopravku\.ru$/, "");
      if (subdomain && subdomain !== url.hostname && subdomain !== "www") return subdomain;
    }
    return url.pathname.split("/").filter(Boolean)[0] || "";
  } catch {
    return "";
  }
}
