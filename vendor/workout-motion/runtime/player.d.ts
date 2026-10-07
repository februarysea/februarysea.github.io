export interface PlayerOptions {
    autoplay?: boolean;
    speed?: number;
    phase?: number;
    respectReducedMotion?: boolean;
    onStateChange?: (playing: boolean) => void;
}
export interface WorkoutPlayer {
    play(): void;
    pause(): void;
    seek(phase: number): void;
    setSpeed(speed: number): void;
    destroy(): void;
    readonly playing: boolean;
    readonly progress: number;
}
/** Mount one SVG player. Importing this module itself never accesses the DOM. */
export declare function createPlayer(host: HTMLElement, id: string, options?: PlayerOptions): WorkoutPlayer;
