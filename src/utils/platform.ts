export function isApplePlatform(platform = navigator.platform): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function shortcutModifierLabel(platform = navigator.platform): "⌘" | "Ctrl" {
  return isApplePlatform(platform) ? "⌘" : "Ctrl";
}
