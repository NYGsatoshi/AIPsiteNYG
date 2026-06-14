import enUS from "./locales/en-US.js";
import jaJP from "./locales/ja-JP.js";

export const DEFAULT_LOCALE = "ja-JP";
export const SUPPORTED_LOCALES = ["ja-JP", "en-US"];
export const LANGUAGE_STORAGE_KEY = "aip.locale";

const dictionaries = { "en-US": enUS, "ja-JP": jaJP };
let currentLocale = readStoredLocale();

document.documentElement.lang = currentLocale;

function readStoredLocale() {
  const stored = window.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
  return SUPPORTED_LOCALES.includes(stored) ? stored : DEFAULT_LOCALE;
}

export function locale() { return currentLocale; }

export function setLocale(nextLocale) {
  if (!SUPPORTED_LOCALES.includes(nextLocale) || nextLocale === currentLocale) return;
  currentLocale = nextLocale;
  window.localStorage?.setItem(LANGUAGE_STORAGE_KEY, nextLocale);
  document.documentElement.lang = nextLocale;
  window.dispatchEvent(new CustomEvent("aip:locale-changed", { detail: { locale: nextLocale } }));
}

export function t(key, values = {}, fallback = key) {
  const template = dictionaries[currentLocale]?.[key] ?? dictionaries[DEFAULT_LOCALE]?.[key] ?? dictionaries["en-US"]?.[key] ?? fallback;
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value ?? "")), template);
}

export function localeOptions() {
  return [
    { value: "ja-JP", label: t("language.japanese") },
    { value: "en-US", label: t("language.english") }
  ];
}

export function renderLanguageSelector(className = "language-selector") {
  return `
    <label class="${className}">
      <span>${t("language.label")}</span>
      <select data-language-selector aria-label="${t("language.label")}">
        ${localeOptions().map((option) => `<option value="${option.value}" ${option.value === currentLocale ? "selected" : ""}>${option.label}</option>`).join("")}
      </select>
    </label>
  `;
}

export function bindLanguageSelectors(root = document) {
  root.querySelectorAll("[data-language-selector]").forEach((select) => {
    select.addEventListener("change", (event) => setLocale(event.currentTarget.value));
  });
}
