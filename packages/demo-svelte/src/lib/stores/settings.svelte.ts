import { browser } from "$app/environment";

function getCookie(name: string): string | null {
  if (!browser) return null;

  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string) {
  if (!browser) return;

  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

class Settings {
  ssr = $state(getCookie("settings-ssr") !== "false");
  cachePolicy = $state(getCookie("settings-cache-policy") ?? "cache-first");
  relayMode = $state(getCookie("settings-relay-mode") ?? "infinite");
  optimistic = $state(getCookie("settings-optimistic") !== "false");

  constructor() {
    if (browser) {
      $effect.root(() => {
        $effect(() => {
          setCookie("settings-ssr", String(this.ssr));
        });

        $effect(() => {
          setCookie("settings-cache-policy", this.cachePolicy);
        });

        $effect(() => {
          setCookie("settings-relay-mode", this.relayMode);
        });

        $effect(() => {
          setCookie("settings-optimistic", String(this.optimistic));
        });
      });
    }
  }

  reload() {
    if (browser) {
      window.location.reload();
    }
  }
}

let settingsInstance: Settings | null = null;

export function getSettings(): Settings {
  if (!settingsInstance) {
    settingsInstance = new Settings();
  }

  return settingsInstance;
}
