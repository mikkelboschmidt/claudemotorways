declare const posthog: { capture: (event: string, properties?: Record<string, string>) => void } | undefined;

export function track(event: string, data?: Record<string, string>) {
  if (typeof posthog !== 'undefined') {
    posthog.capture(event, data);
  }
}
