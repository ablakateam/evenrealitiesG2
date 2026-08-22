import {
  waitForEvenAppBridge,
  OsEventTypeList,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';

/**
 * Bridge wrapper + event normalization.
 *
 * The raw SDK event splits across four envelopes (sysEvent / textEvent /
 * listEvent / audioEvent) and — critically — protobuf omits zero-value
 * fields on the wire, so CLICK_EVENT (0) arrives as `undefined`. We coalesce
 * with `?? 0` and flatten everything into one tagged union the page layer
 * can switch on cleanly.
 */
export type NormalizedEvent =
  | { kind: 'tap'; containerID: number | null }
  | { kind: 'double-tap' }
  | { kind: 'scroll-up' }
  | { kind: 'scroll-down' }
  | {
      kind: 'list-select';
      containerID: number;
      index: number;
      name: string;
      /**
       * False when the firmware omitted `currentSelectItemIndex` entirely.
       *
       * Verified on the simulator (0.9.0): a tap on the FIRST row sends
       * `{containerID, containerName}` with no index — protobuf drops the
       * zero — while a tap after scrolling sends `currentSelectItemIndex: 2`.
       * So `index: 0` is genuinely correct for an omitted field, and pages
       * must not treat "omitted" as "unknown". This flag exists so a page
       * that puts a destructive action on row 0 can require an explicit
       * selection before firing it.
       */
      indexReported: boolean;
    }
  | { kind: 'foreground-enter' }
  | { kind: 'foreground-exit' }
  | { kind: 'system-exit' }
  | { kind: 'abnormal-exit' }
  | { kind: 'audio'; pcm: Uint8Array }
  | { kind: 'imu'; x: number; y: number; z: number };

let bridgeInstance: EvenAppBridge | null = null;

/** Get the SDK bridge (must be called after initBridge resolves). */
export function getBridge(): EvenAppBridge {
  if (!bridgeInstance) throw new Error('bridge not initialized — await initBridge() first');
  return bridgeInstance;
}

let bridgeInit: Promise<EvenAppBridge> | null = null;

/** Bootstrap the bridge once. Resolves when the host WebView is ready. */
export async function initBridge(): Promise<EvenAppBridge> {
  if (bridgeInstance) return bridgeInstance;
  // Memoize the in-flight promise, not just the result. Two callers racing at
  // boot (the companion resolving its pairing, and main() booting the HUD)
  // must await the SAME handshake rather than starting two.
  bridgeInit ??= waitForEvenAppBridge().then((b) => {
    bridgeInstance = b;
    return b;
  });
  return bridgeInit;
}

/**
 * Await the bridge, giving up after `timeoutMs` and resolving null instead of
 * throwing.
 *
 * This exists because the companion needs to read KVS *before* the HUD boots,
 * and KVS only works through the bridge. Calling `getBridge()` at that point
 * threw "bridge not initialized", `kvGet` swallowed it, and every launch looked
 * unpaired no matter what was stored — the pairing screen came back forever.
 *
 * The timeout keeps a plain browser (no host SDK, where the handshake never
 * completes) from hanging the companion instead of rendering it.
 */
export async function whenBridgeReady(timeoutMs = 4000): Promise<EvenAppBridge | null> {
  if (bridgeInstance) return bridgeInstance;
  try {
    return await Promise.race([
      initBridge(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

/**
 * Normalize a raw SDK event into a tagged union. Returns null for events we
 * don't model (keeps the switch in the page layer exhaustive + tidy).
 */
export function normalizeEvent(event: EvenHubEvent): NormalizedEvent | null {
  // Audio frames (mic PCM)
  if (event.audioEvent?.audioPcm) {
    return { kind: 'audio', pcm: event.audioEvent.audioPcm };
  }

  // List selection
  if (event.listEvent) {
    const t = event.listEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
    if (t === OsEventTypeList.CLICK_EVENT) {
      return {
        kind: 'list-select',
        containerID: event.listEvent.containerID ?? 0,
        index: event.listEvent.currentSelectItemIndex ?? 0,
        name: event.listEvent.currentSelectItemName ?? '',
        indexReported: event.listEvent.currentSelectItemIndex !== undefined,
      };
    }
    if (t === OsEventTypeList.SCROLL_TOP_EVENT) return { kind: 'scroll-up' };
    if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT) return { kind: 'scroll-down' };
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) return { kind: 'double-tap' };
  }

  // Text container events
  if (event.textEvent) {
    const t = event.textEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
    return eventFromType(t, event.textEvent.containerID ?? null);
  }

  // System events (taps, lifecycle, IMU)
  if (event.sysEvent) {
    const t = event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
    if (t === OsEventTypeList.IMU_DATA_REPORT && event.sysEvent.imuData) {
      return {
        kind: 'imu',
        x: event.sysEvent.imuData.x ?? 0,
        y: event.sysEvent.imuData.y ?? 0,
        z: event.sysEvent.imuData.z ?? 0,
      };
    }
    // A sysEvent carries no containerID — it's a raw temple touch that the
    // firmware did not attribute to any container.
    return eventFromType(t, null);
  }

  return null;
}

function eventFromType(t: OsEventTypeList, containerID: number | null): NormalizedEvent | null {
  switch (t) {
    case OsEventTypeList.CLICK_EVENT:
      return { kind: 'tap', containerID };
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return { kind: 'double-tap' };
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return { kind: 'scroll-up' };
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return { kind: 'scroll-down' };
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      return { kind: 'foreground-enter' };
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      return { kind: 'foreground-exit' };
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
      return { kind: 'system-exit' };
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
      return { kind: 'abnormal-exit' };
    default:
      return null;
  }
}
