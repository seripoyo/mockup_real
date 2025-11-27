export type DeviceCategory = 'smartphone' | 'tablet' | 'laptop' | 'desktop';
export type AspectRatio = '9:16' | '16:9' | '1:1';

export interface ScreenRectPct {
  xPct: number; // 0..1 left offset relative to frame width
  yPct: number; // 0..1 top offset relative to frame height
  wPct: number; // 0..1 width relative to frame width
  hPct: number; // 0..1 height relative to frame height
}

export interface ScreenRegion {
  id: string;
  name: string;
  rect: ScreenRectPct;
}

export interface FrameMeta {
  id: string;
  name: string;
  category: DeviceCategory;
  frameImage: string; // absolute public path starting with /assets/
  aspectSupport: AspectRatio[];
  screenRect?: ScreenRectPct; // single-screen legacy
  screenRects?: ScreenRegion[]; // multi-screen (e.g., laptop + phone)
}
