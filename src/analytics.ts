declare const posthog: { capture: (event: string, properties?: Record<string, string | number>) => void } | undefined;

export function track(event: string, data?: Record<string, string | number>) {
  if (typeof posthog !== 'undefined') {
    posthog.capture(event, data);
  }
}
