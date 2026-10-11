import type { CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { LAYER } from '../../atlas/palette';

export interface SceneControlsProps {
  floors: readonly { key: string; label: string; short: string; available: boolean; pending?: boolean }[];
  selectedFloorKey: string;
  onFloorChange: (key: string) => void;
  mode: '3d' | 'plan';
  onModeChange: (mode: '3d' | 'plan') => void;
  exploded: boolean;
  onExplodedChange: (value: boolean) => void;
  yaw: number;
  onYawChange: (value: number) => void;
  pitch: number;
  onPitchChange: (value: number) => void;
  zoom: number;
  onZoomChange: (value: number) => void;
  overlay: 'spaces' | 'electrical' | 'network';
  onOverlayChange: (value: 'spaces' | 'electrical' | 'network') => void;
  onReset: () => void;
}

const OVERLAYS = ['spaces', 'electrical', 'network'] as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function SceneControls({
  floors,
  selectedFloorKey,
  onFloorChange,
  mode,
  onModeChange,
  exploded,
  onExplodedChange,
  yaw,
  onYawChange,
  pitch,
  onPitchChange,
  zoom,
  onZoomChange,
  overlay,
  onOverlayChange,
  onReset,
}: SceneControlsProps) {
  return (
    <>
      <nav className="stage-ui floor-rail" aria-label="Floors">
        {floors.map((floor) => (
          <button
            key={floor.key}
            type="button"
            className={`floor-btn${floor.key === selectedFloorKey ? ' is-current' : ''}${floor.available ? '' : ' is-noplan'}`}
            aria-label={`${floor.label}: ${floor.available ? 'provisional scan' : floor.pending ? 'preparing scan' : 'scan unavailable'}`}
            aria-pressed={floor.key === selectedFloorKey}
            onClick={() => onFloorChange(floor.key)}
            disabled={!floor.available}
          >
            <span className="floor-short">{floor.short}</span>
            <span className="floor-meta">
              <span className="floor-name">{floor.label}</span>
              <span className="floor-sub">{floor.available ? 'Provisional scan' : floor.pending ? 'Preparing scan' : 'Scan unavailable'}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="stage-ui view-ctrl">
        <div className="seg" role="group" aria-label="Model view">
          <button type="button" aria-pressed={mode === '3d'} onClick={() => onModeChange('3d')}>
            3D
          </button>
          <button type="button" aria-pressed={mode === 'plan'} onClick={() => onModeChange('plan')}>
            Plan
          </button>
        </div>
        {mode === '3d' && (
          <button
            type="button"
            className="ctrl-btn ctrl-wide"
            aria-pressed={exploded}
            onClick={() => onExplodedChange(!exploded)}
          >
            <Icon name="explode" size={17} />
            <span>{exploded ? 'Exploded' : 'Stacked'}</span>
          </button>
        )}
        <div className="ctrl-group" role="group" aria-label="Camera">
          {mode === '3d' && (
            <>
              <button type="button" className="ctrl-btn" aria-label="Turn model left" onClick={() => onYawChange(yaw - 45)}>
                <Icon name="rotl" size={17} />
              </button>
              <button type="button" className="ctrl-btn" aria-label="Turn model right" onClick={() => onYawChange(yaw + 45)}>
                <Icon name="rotr" size={17} />
              </button>
            </>
          )}
          <button
            type="button"
            className="ctrl-btn"
            aria-label="Zoom in"
            onClick={() => onZoomChange(clamp(zoom * 1.3, 1, 3.2))}
            disabled={zoom >= 3.2}
          >
            <Icon name="plus" size={17} />
          </button>
          <button
            type="button"
            className="ctrl-btn"
            aria-label="Zoom out"
            onClick={() => onZoomChange(clamp(zoom / 1.3, 1, 3.2))}
            disabled={zoom <= 1}
          >
            <Icon name="minus" size={17} />
          </button>
          <button type="button" className="ctrl-btn" aria-label="Reset view" title="Reset view" onClick={onReset}>
            <Icon name="fit" size={17} />
          </button>
        </div>
        {mode === '3d' && (
          <label className="tilt">
            <span>Tilt</span>
            <input
              type="range"
              min={18}
              max={64}
              step={1}
              value={clamp(pitch, 18, 64)}
              onChange={(event) => onPitchChange(Number(event.target.value))}
            />
          </label>
        )}
      </div>

      <div className="stage-ui stage-bottom">
        <div className="layer-bar" role="group" aria-label="Overlay">
          {OVERLAYS.map((key) => {
            const layer = LAYER[key];
            return (
              <button
                key={key}
                type="button"
                aria-label={layer.label}
                aria-pressed={overlay === key}
                className="layer-chip"
                style={{
                  '--layer': layer.color,
                  background: overlay === key ? 'color-mix(in srgb, var(--layer) 13%, #fff)' : undefined,
                  borderColor: overlay === key ? 'color-mix(in srgb, var(--layer) 55%, #fff)' : undefined,
                  color: overlay === key ? 'var(--ink)' : undefined,
                } as CSSProperties}
                onClick={() => onOverlayChange(key)}
              >
                <span className="layer-swatch" aria-hidden="true" />
                {layer.short}
              </button>
            );
          })}
        </div>
      </div>
      <p className="stage-ui demo-note">Schematic room anchors · display-only floor spacing</p>
    </>
  );
}
