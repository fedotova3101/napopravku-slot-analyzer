export function getChromiumLaunchOptions({ headless }) {
  return {
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-component-update",
      "--disable-background-networking",
      "--disable-features=site-per-process,Translate,BackForwardCache",
      "--no-zygote",
      "--start-minimized",
      "--window-position=-32000,-32000",
      "--window-size=1200,900",
      "--disable-blink-features=AutomationControlled",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding"
    ]
  };
}
