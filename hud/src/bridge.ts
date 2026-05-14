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
  | { kind: 'tap' }
  | { kind: 'double-tap' }
  | { kind: 'scroll-up' }
  | { kind: 'scroll-down' }
  | { kind: 'list-select'; containerID: number; index: number; name: string }
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

/** Bootstrap the bridge once. Resolves when the host WebView is ready. */
export async function initBridge(): Promise<EvenAppBridge> {
  if (bridgeInstance) return bridgeInstance;
  bridgeInstance = await waitForEvenAppBridge();
  return bridgeInstance;
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
      };
    }
    if (t === OsEventTypeList.SCROLL_TOP_EVENT) return { kind: 'scroll-up' };
    if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT) return { kind: 'scroll-down' };
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) return { kind: 'double-tap' };
  }

  // Text container events
  if (event.textEvent) {
    const t = event.textEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
    return eventFromType(t);
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
    return eventFromType(t);
  }

  return null;
}

function eventFromType(t: OsEventTypeList): NormalizedEvent | null {
  switch (t) {
    case OsEventTypeList.CLICK_EVENT:
      return { kind: 'tap' };
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
