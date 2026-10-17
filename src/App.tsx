import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Bluetooth, Heart, Play, Pause, Square, Activity, ShieldCheck, Compass, Sliders, Sparkles, Map, Mountain, Home, X } from 'lucide-react';
import {
  ITrainer,
  TelemetrySample,
  RideState,
  RouteModel,
  RoutePoint,
  TrainerConnectionStatus,
  TrainerControlMode,
} from './types/cycling';
import { FtmsTreadmill } from './ble/ftmsTreadmill';
import { FitImport } from './components/FitImport';
import { TreadmillHud } from './components/TreadmillHud';
import { hasFreshTrainerTelemetry } from './ride/rideSafety';
import { FtmsTrainer } from './ble/ftmsTrainer';
import { BleHeartRateMonitor } from './ble/bleHeartRate';
import { MockTrainer } from './ble/mockTrainer';
import { VirtualSpeedEngine } from './physics/virtualSpeed';
import { getInterpolatedProgress } from './route/routeTracker';
import { PRESET_ROUTES } from './route/presets';
import { rideJournal, SavedRideSession } from './storage/rideJournal';
import { wakeLockManager } from './utils/wakeLock';
import { makeTrainerTelemetrySafe } from './ride/rideSafety';
import { loadSelectedRoute, saveSelectedRoute } from './storage/appPreferences';

import { loadRideHistory, loadPreviousRide } from './storage/rideHistory';
import { buildDemoGhost } from './ride/demoGhost';
import { buildGhost, ghostDistanceAt, type GhostRide } from './ride/ghostRace';
import { RacePicker, RaceHud } from './components/RaceYourself';

import { HUD } from './components/Hud';
import { ElevationRibbon } from './components/ElevationRibbon';
import { RoutePicker } from './components/RoutePicker';
import { MockTrainerControls } from './components/MockTrainerControls';
import { ConnectModal } from './components/ConnectModal';
import { SummaryModal } from './components/SummaryModal';
import { CrashRecoveryModal } from './components/CrashRecoveryModal';
import { EndRideModal } from './components/EndRideModal';
import {
  isScenicQualityMode,
  isScenicTheme,
  SCENIC_QUALITY_OPTIONS,
  SCENIC_THEME_OPTIONS,
  type ScenicQualityMode,
  type ScenicTheme,
} from './types/scenic';
import { ScenicHud } from './components/ScenicHud';
import { ScenicClimbBar } from './components/ScenicClimbBar';

const Map3D = lazy(() => import('./components/Map3D').then((module) => ({ default: module.Map3D })));
const ScenicRide = lazy(() => import('./components/ScenicRide').then((module) => ({ default: module.ScenicRide })));

const RIDER_WEIGHT_KEY = 'tour_de_home_rider_weight_kg';
const LEGACY_RIDER_WEIGHT_KEY = 'veloquest_rider_weight_kg';
const RIDE_VIEW_KEY = 'tour_de_home_ride_view';
const SCENIC_THEME_KEY = 'tour_de_home_scenic_theme';
const SCENIC_QUALITY_KEY = 'tour_de_home_scenic_quality';

type RideViewMode = 'map' | 'scenic';

const INITIAL_TELEMETRY: TelemetrySample = {
  timestamp: Date.now(),
  powerWatts: 0,
  cadenceRpm: 0,
  flywheelSpeedKph: 0,
  virtualSpeedKph: 0,
  distanceMeters: 0,
  gradePercent: 0,
  elevationMeters: 0,
  lat: 0,
  lng: 0,
};

export function App() {
  const demoLaunchRequested = useRef(new URLSearchParams(window.location.search).get('demo') === '1');
  const demoLaunchConsumed = useRef(false);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  // Active course
  const [selectedRoute, setSelectedRoute] = useState<RouteModel>(PRESET_ROUTES[0]);
  const [currentRoutePoint, setCurrentRoutePoint] = useState<RoutePoint | null>(
    PRESET_ROUTES[0].points[0]
  );

  // Trainer State
  const [trainer, setTrainer] = useState<ITrainer | null>(null);
  const isTreadmill = trainer?.activityType === 'running';
  const sessionSportRef = useRef<'cycling' | 'running'>('cycling');
  const treadmillRef = useRef<FtmsTreadmill | null>(null);
  const [isMock, setIsMock] = useState<boolean>(false);
  const [isConnectOpen, setIsConnectOpen] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [trainerConnection, setTrainerConnection] = useState<TrainerConnectionStatus>({ state: 'disconnected' });

  // Ride State
  const [rideState, setRideState] = useState<RideState>('idle');
  // Armed = course loaded, waiting for the first pedal strokes to auto-start the ride.
  const [isArmed, setIsArmed] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<TelemetrySample>({
    ...INITIAL_TELEMETRY,
    gradePercent: PRESET_ROUTES[0].points[0].grade,
    elevationMeters: PRESET_ROUTES[0].points[0].elevation,
    lat: PRESET_ROUTES[0].points[0].lat,
    lng: PRESET_ROUTES[0].points[0].lng,
  });
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [totalDistanceMeters, setTotalDistanceMeters] = useState<number>(0);
  const [wattsHistory, setWattsHistory] = useState<number[]>([]);
  const [trainerDifficulty, setTrainerDifficulty] = useState<number>(70);
  const [riderWeightKg, setRiderWeightKg] = useState<number>(() => {
    try {
      const saved = Number(
        window.localStorage.getItem(RIDER_WEIGHT_KEY)
          ?? window.localStorage.getItem(LEGACY_RIDER_WEIGHT_KEY)
      );
      return Number.isFinite(saved) && saved >= 35 && saved <= 200 ? saved : 75;
    } catch {
      return 75;
    }
  });
  const [controlMode, setControlMode] = useState<TrainerControlMode>('route');
  const [ergTargetWatts, setErgTargetWatts] = useState<number>(200);
  const [controlError, setControlError] = useState<string | null>(null);
  const [rideLifecycleError, setRideLifecycleError] = useState<string | null>(null);
  const [rideViewMode, setRideViewMode] = useState<RideViewMode>(() => {
    try {
      return window.localStorage.getItem(RIDE_VIEW_KEY) === 'map' ? 'map' : 'scenic';
    } catch {
      return 'scenic';
    }
  });
  const [scenicTheme, setScenicTheme] = useState<ScenicTheme>(() => {
    try {
      const savedTheme = window.localStorage.getItem(SCENIC_THEME_KEY);
      return isScenicTheme(savedTheme) ? savedTheme : 'deathisland';
    } catch {
      return 'deathisland';
    }
  });
  const [scenicQualityMode, setScenicQualityMode] = useState<ScenicQualityMode>(() => {
    try {
      const savedQuality = window.localStorage.getItem(SCENIC_QUALITY_KEY);
      return isScenicQualityMode(savedQuality) ? savedQuality : 'auto';
    } catch {
      return 'auto';
    }
  });

  const [previousRides, setPreviousRides] = useState<SavedRideSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReload, setHistoryReload] = useState(0);
  const [selectedGhostId, setSelectedGhostId] = useState('');
  const [recordedRaceGhost, setRaceGhost] = useState<GhostRide | null>(null);
  const [demoGhost, setDemoGhost] = useState<GhostRide | null>(null);
  const [demoGhostEnabled, setDemoGhostEnabled] = useState(true);
  const raceGhost = demoGhost ? (demoGhostEnabled ? demoGhost : null) : recordedRaceGhost;
  const ghosts = useMemo(() => previousRides.map(ride => buildGhost(ride, selectedRoute))
    .filter((ghost): ghost is GhostRide => ghost !== null), [previousRides, selectedRoute]);
  const selectedGhost = ghosts.find(ghost => ghost.id === selectedGhostId) ?? null;

  // Completed Session Modal
  const [completedSession, setCompletedSession] = useState<SavedRideSession | null>(null);
  const [isSummaryOpen, setIsSummaryOpen] = useState<boolean>(false);

  // Crash Recovery State
  const [unrecoveredSession, setUnrecoveredSession] = useState<SavedRideSession | null>(null);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState<boolean>(false);
  const [isEndRideOpen, setIsEndRideOpen] = useState<boolean>(false);
  const [hasLoadedRoutePreference, setHasLoadedRoutePreference] = useState<boolean>(false);

  // Simulator controls state (Synced to 220W / 90 RPM)
  const [mockWatts, setMockWatts] = useState<number>(220);
  const [mockCadence, setMockCadence] = useState<number>(90);
  const [showSimulatorBar, setShowSimulatorBar] = useState<boolean>(true);
  const [hrDeviceName, setHrDeviceName] = useState<string | null>(null);
  const [scenicControlsOpen, setScenicControlsOpen] = useState<boolean>(false);

  // Stable References to avoid interval teardowns
  const physicsEngineRef = useRef<VirtualSpeedEngine>(new VirtualSpeedEngine());
  const mockTrainerRef = useRef<MockTrainer | null>(null);
  const hrMonitorRef = useRef<BleHeartRateMonitor | null>(null);
  const ftmsTrainerRef = useRef<FtmsTrainer | null>(null);
  const latestTelemetryRef = useRef<TelemetrySample>(INITIAL_TELEMETRY);
  const selectedRouteRef = useRef<RouteModel>(selectedRoute);
  const currentRoutePointRef = useRef<RoutePoint | null>(currentRoutePoint);
  const lastResistanceGradeRef = useRef<number | null>(null);
  const lastErgTargetRef = useRef<number | null>(null);
  const totalDistanceRef = useRef<number>(0);
  const routeFinishedRef = useRef<boolean>(false);
  const elapsedMillisecondsRef = useRef<number>(0);
  const elapsedSecondsRef = useRef<number>(0);
  const trainerConnectionRef = useRef<TrainerConnectionStatus>({ state: 'disconnected' });
  const rideStateBeforeExitRef = useRef<RideState>('paused');
  const rideStateRef = useRef<RideState>(rideState);
  const routeInteractedRef = useRef(false);
  // Armed-ride refs: onTelemetry supports a single subscriber, so pedal detection
  // must live inside the main telemetry listener rather than a second subscription.
  const isArmedRef = useRef<boolean>(false);
  const armedTriggerFiredRef = useRef<boolean>(false);
  const startRideNowRef = useRef<() => void>(() => {});
  // Pedal-to-resume: only fires after the pedals have actually gone quiet since
  // the pause, so pausing while still spinning doesn't instantly resume.
  const pauseQuietRef = useRef<boolean>(false);
  const resumeRideNowRef = useRef<() => void>(() => {});
  const blockingModalOpenRef = useRef<boolean>(false);
  const pendingResistanceGradeRef = useRef<number | null>(null);
  const pendingErgTargetRef = useRef<number | null>(null);

  const neutralizeTrainer = useCallback(async (
    controller: ITrainer | null = trainer,
  ): Promise<boolean> => {
    if (!controller || !controller.capabilities.control) return false;
    try {
      await controller.neutralize();
      lastResistanceGradeRef.current = 0;
      lastErgTargetRef.current = null;
      pendingResistanceGradeRef.current = null;
      pendingErgTargetRef.current = null;
      return true;
    } catch (error) {
      console.warn('[FTMS] Could not neutralize trainer:', error);
      setControlError('Could not neutralize trainer resistance. Stop pedaling and check the trainer before continuing.');
      return false;
    }
  }, [trainer]);

  useEffect(() => {
    rideStateRef.current = rideState;
  }, [rideState]);

  useEffect(() => {
    selectedRouteRef.current = selectedRoute;
  }, [selectedRoute]);

  useEffect(() => {
    let active = true;
    void loadSelectedRoute().then((savedRoute) => {
      if (!active) return;
      if (savedRoute && !routeInteractedRef.current && rideStateRef.current === 'idle') {
        setSelectedRoute(savedRoute);
        selectedRouteRef.current = savedRoute;
      }
      setHasLoadedRoutePreference(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedRoutePreference) return;
    void saveSelectedRoute(selectedRoute);
  }, [hasLoadedRoutePreference, selectedRoute]);

  useEffect(() => {
    currentRoutePointRef.current = currentRoutePoint;
  }, [currentRoutePoint]);

  useEffect(() => {
    physicsEngineRef.current.updateProfile({ riderWeightKg });
    try {
      window.localStorage.setItem(RIDER_WEIGHT_KEY, String(riderWeightKg));
    } catch {
      // Storage can be unavailable in private browsing; the in-memory value still works.
    }
  }, [riderWeightKg]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RIDE_VIEW_KEY, rideViewMode);
      window.localStorage.setItem(SCENIC_THEME_KEY, scenicTheme);
      window.localStorage.setItem(SCENIC_QUALITY_KEY, scenicQualityMode);
    } catch {
      // View preferences are optional when browser storage is unavailable.
    }
  }, [rideViewMode, scenicQualityMode, scenicTheme]);

  useEffect(() => {
    if (rideState !== 'idle') return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    void loadRideHistory().then(rides => { if (!cancelled) setPreviousRides(rides); })
      .catch(() => { if (!cancelled) setHistoryError('Previous rides could not be loaded. You can still ride without a ghost.'); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [rideState, historyReload]);

  // Persist the final sub-second point of every pause, including dropouts and Home.
  const previousRideStateRef = useRef<RideState>('idle');
  useEffect(() => {
    const wasRiding = previousRideStateRef.current === 'riding';
    previousRideStateRef.current = rideState;
    // Opening a recovered, already-paused ride must not rewrite its saved prefix.
    if (!wasRiding || rideState !== 'paused') return;
    void rideJournal.recordSample({ ...latestTelemetryRef.current, timestamp: Date.now() }, elapsedMillisecondsRef.current / 1000)
      .catch(() => setRideLifecycleError('Could not save the pause checkpoint. Keep this page open and retry finishing the ride.'));
  }, [rideState]);

  // Check for crash recovery on mount
  useEffect(() => {
    let active = true;
    rideJournal.restoreUnfinishedSession().then((session) => {
      if (!active) return;
      if (session) {
        setUnrecoveredSession(session);
        setIsRecoveryOpen(true);
      }
      setRecoveryChecked(true);
    }).catch(() => {
      if (active) setRideLifecycleError('Could not check saved rides. Automatic demo launch was stopped to protect your previous ride. Reload to retry.');
    });
    return () => { active = false; };
  }, []);

  // Sync initial route point when selectedRoute changes
  useEffect(() => {
    if (rideState === 'idle' && selectedRoute && selectedRoute.points.length > 0) {
      const initialPt = selectedRoute.points[0];
      setCurrentRoutePoint(initialPt);
      currentRoutePointRef.current = initialPt;
      setTelemetry((prev) => ({
        ...prev,
        gradePercent: initialPt.grade,
        elevationMeters: initialPt.elevation,
        lat: initialPt.lat,
        lng: initialPt.lng,
      }));
    }
  }, [selectedRoute, rideState]);

  // 1. Setup Active Trainer Listeners
  useEffect(() => {
    if (!trainer) return;

    const unsubscribeTelemetry = trainer.onTelemetry((sample: TelemetrySample) => {
      const current = latestTelemetryRef.current;
      latestTelemetryRef.current = {
        ...current,
        timestamp: sample.timestamp,
        powerWatts: sample.powerWatts,
        cadenceRpm: sample.cadenceRpm,
        flywheelSpeedKph: sample.flywheelSpeedKph,
        treadmillInclinePercent: sample.treadmillInclinePercent,
        heartRateBpm: sample.heartRateBpm ?? current.heartRateBpm,
      };

      if (
        isArmedRef.current &&
        !armedTriggerFiredRef.current &&
        (trainer.activityType === 'running' ? sample.flywheelSpeedKph > 0 : (sample.powerWatts > 15 || sample.cadenceRpm > 25))
      ) {
        armedTriggerFiredRef.current = true;
        isArmedRef.current = false;
        setIsArmed(false);
        startRideNowRef.current();
      }

      if (trainer.activityType !== 'running' && rideStateRef.current === 'paused' && trainerConnectionRef.current.state === 'connected') {
        if (sample.powerWatts < 5 && sample.cadenceRpm < 5) {
          pauseQuietRef.current = true;
        } else if (
          pauseQuietRef.current &&
          !blockingModalOpenRef.current &&
          !routeFinishedRef.current &&
          (sample.powerWatts > 15 || sample.cadenceRpm > 25)
        ) {
          pauseQuietRef.current = false;
          resumeRideNowRef.current();
        }
      }
    });

    const unsubscribe = trainer.onConnectionState((status) => {
      trainerConnectionRef.current = status;
      setTrainerConnection(status);

      if (status.state !== 'connected') {
        const safeTelemetry = makeTrainerTelemetrySafe(
          latestTelemetryRef.current,
          status.state,
          Date.now(),
        );
        latestTelemetryRef.current = safeTelemetry;
        setTelemetry(safeTelemetry);
      }

      if (status.state !== 'connected') {
        pauseQuietRef.current = false;
        if (rideStateRef.current === 'riding') {
          rideStateRef.current = 'paused';
          setRideState('paused');
        }
        void neutralizeTrainer(trainer);
        setControlError(status.message ?? 'Trainer connection was lost. The ride has been paused.');
        wakeLockManager.releaseWakeLock();
      } else if (status.state === 'connected') {
        lastResistanceGradeRef.current = null;
        lastErgTargetRef.current = null;
        pendingResistanceGradeRef.current = null;
        pendingErgTargetRef.current = null;
        if (rideStateRef.current !== 'riding') void neutralizeTrainer(trainer);
        setControlError(
          trainer.capabilities.control || trainer.activityType === 'running'
            ? null
            : 'Telemetry is connected, but resistance control is unavailable. Route and ERG controls are disabled.',
        );
      }
    });

    return () => {
      unsubscribeTelemetry();
      unsubscribe();
    };
  }, [neutralizeTrainer, trainer]);

  // 2. STABLE High-Frequency Physics Loop (10 Hz = 100ms) - Dependency ONLY on rideState
  useEffect(() => {
    if (rideState !== 'riding') return;

    let previousTick = performance.now();
    const interval = setInterval(() => {
      const tick = performance.now();
      if (rideStateRef.current !== 'riding' || trainerConnectionRef.current.state !== 'connected') {
        previousTick = tick;
        return;
      }
      const dtSeconds = Math.max(0, (tick - previousTick) / 1000);
      previousTick = tick;

      if (trainer?.activityType === 'running' && (!hasFreshTrainerTelemetry(latestTelemetryRef.current, trainerConnectionRef.current.state, Date.now()) || latestTelemetryRef.current.flywheelSpeedKph <= 0)) {
        rideStateRef.current = 'paused';
        setRideState('paused');
        setControlError('Treadmill stopped or speed signal is stale. Comparison paused. Use the console, then press Resume when ready.');
        return;
      }
      elapsedMillisecondsRef.current += dtSeconds * 1000;
      const wholeElapsedSeconds = Math.floor(elapsedMillisecondsRef.current / 1000);
      if (wholeElapsedSeconds !== elapsedSecondsRef.current) {
        elapsedSecondsRef.current = wholeElapsedSeconds;
        setElapsedSeconds(wholeElapsedSeconds);
      }

      const current = makeTrainerTelemetrySafe(
        latestTelemetryRef.current,
        trainerConnectionRef.current.state,
        Date.now(),
      );
      const physics = physicsEngineRef.current;
      const routePt = currentRoutePointRef.current;
      const route = selectedRouteRef.current;

      const routeGrade = routePt ? routePt.grade : current.gradePercent;
      const { speedKph, distanceDeltaMeters } = trainer?.activityType === 'running'
        ? { speedKph: current.flywheelSpeedKph, distanceDeltaMeters: current.flywheelSpeedKph / 3.6 * dtSeconds }
        : physics.advance(
        current.powerWatts,
        routeGrade,
        dtSeconds
      );

      const newDist = Math.min(route.totalDistanceMeters, totalDistanceRef.current + distanceDeltaMeters);

      // Interpolate position along route
      const progress = getInterpolatedProgress(route, newDist);
      setCurrentRoutePoint(progress.currentPoint);
      currentRoutePointRef.current = progress.currentPoint;
      totalDistanceRef.current = newDist;
      setTotalDistanceMeters(newDist);

      const updatedSample: TelemetrySample = {
        ...current,
        activeTimeSeconds: elapsedMillisecondsRef.current / 1000,
        virtualSpeedKph: speedKph,
        distanceMeters: newDist,
        gradePercent: progress.currentPoint.grade,
        elevationMeters: progress.currentPoint.elevation,
        lat: route.synthetic ? undefined : progress.currentPoint.lat,
        lng: route.synthetic ? undefined : progress.currentPoint.lng,
      };
      latestTelemetryRef.current = updatedSample;
      setTelemetry(updatedSample);

      if (progress.isFinished && !routeFinishedRef.current) {
        routeFinishedRef.current = true;
        void handleEndRide();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [rideState]);

  // 3. 1 Hz Stopwatch, Journal Logger & Resistance Updater
  useEffect(() => {
    if (rideState !== 'riding') return;

    const timer = setInterval(() => {
      if (rideStateRef.current !== 'riding') return;
      const currentSample = makeTrainerTelemetrySafe(
        latestTelemetryRef.current,
        trainerConnectionRef.current.state,
        Date.now(),
      );
      setWattsHistory((prev) => [...prev, currentSample.powerWatts]);

      // Persist the real active duration so delayed background timers cannot lose time.
      void rideJournal.recordSample({ ...currentSample, timestamp: Date.now() }, elapsedMillisecondsRef.current / 1000).catch((error) => {
        console.error('[RideJournal] Could not save sample:', error);
      });

      // Push route simulation or a fixed ERG target to the trainer.
      if (trainer && trainer.isConnected && trainerConnectionRef.current.state === 'connected' && trainer.capabilities.control) {
        if (controlMode === 'erg') {
          if (
            lastErgTargetRef.current !== ergTargetWatts
            && pendingErgTargetRef.current === null
          ) {
            pendingErgTargetRef.current = ergTargetWatts;
            void trainer.setTargetPower(ergTargetWatts)
              .then(() => {
                lastErgTargetRef.current = ergTargetWatts;
                setControlError(null);
              })
              .catch((error) => setControlError(error instanceof Error ? error.message : 'Could not set ERG target.'))
              .finally(() => {
                if (pendingErgTargetRef.current === ergTargetWatts) pendingErgTargetRef.current = null;
              });
          }
        } else {
          const effectiveGrade = currentSample.gradePercent * (trainerDifficulty / 100);
          if (
            (lastResistanceGradeRef.current === null
              || Math.abs(effectiveGrade - lastResistanceGradeRef.current) >= 0.2)
            && pendingResistanceGradeRef.current === null
          ) {
            pendingResistanceGradeRef.current = effectiveGrade;
            void trainer.setGrade(effectiveGrade)
              .then(() => {
                lastResistanceGradeRef.current = effectiveGrade;
                setControlError(null);
              })
              .catch((error) => setControlError(error instanceof Error ? error.message : 'Could not set route resistance.'))
              .finally(() => {
                if (pendingResistanceGradeRef.current === effectiveGrade) pendingResistanceGradeRef.current = null;
              });
          }
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [rideState, trainer, trainerDifficulty, controlMode, ergTargetWatts]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isConnectOpen || isEndRideOpen || isRecoveryOpen || isSummaryOpen) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.isContentEditable
        || target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLButtonElement
        || target instanceof HTMLAnchorElement
      ) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (rideState === 'riding') handlePauseRide();
        else if (rideState === 'paused') handleResumeRide();
      } else if (e.code === 'Escape' && (rideState === 'riding' || rideState === 'paused')) {
        e.preventDefault();
        void handleRequestHome();
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        if (controlMode === 'erg') void handleErgTargetChange(ergTargetWatts + 5);
        else setTrainerDifficulty((prev) => Math.min(100, prev + 5));
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        if (controlMode === 'erg') void handleErgTargetChange(ergTargetWatts - 5);
        else setTrainerDifficulty((prev) => Math.max(0, prev - 5));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [controlMode, ergTargetWatts, isConnectOpen, isEndRideOpen, isRecoveryOpen, isSummaryOpen, rideState]);

  // Connect Handlers
  const canConnectSport = (sport: 'cycling' | 'running') => {
    if ((rideState === 'riding' || rideState === 'paused') && sessionSportRef.current !== sport) {
      setConnectError('Reconnect the same equipment type to resume this activity. Finish it before switching between cycling and treadmill.');
      return false;
    }
    return true;
  };
  const handleConnectTreadmill = async () => {
    if (!canConnectSport('running')) return;
    setIsConnecting(true); setConnectError(null);
    const next = treadmillRef.current ?? (treadmillRef.current = new FtmsTreadmill());
    try {
      if (trainer && trainer !== next) await trainer.disconnect();
      await next.connect();
      setTrainer(next); setIsMock(false); setIsConnectOpen(false);
    } catch (error) { setConnectError(error instanceof Error ? error.message : 'Could not connect to the treadmill.'); }
    finally { setIsConnecting(false); }
  };
  const handleConnectReal = async () => {
    if (!canConnectSport('cycling')) return;
    setIsConnecting(true);
    setConnectError(null);
    try {
      if (!ftmsTrainerRef.current) {
        ftmsTrainerRef.current = new FtmsTrainer();
      }
      if (trainer && trainer !== ftmsTrainerRef.current) await trainer.disconnect();
      await ftmsTrainerRef.current.connect();
      setTrainer(ftmsTrainerRef.current);
      setIsMock(false);
      setIsConnectOpen(false);
    } catch (err: any) {
      setConnectError(err.message || 'Failed to connect to Bluetooth trainer.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnectMock = async () => {
    if (!canConnectSport('cycling')) return;
    setIsConnecting(true);
    setConnectError(null);
    try {
      if (!mockTrainerRef.current) {
        mockTrainerRef.current = new MockTrainer();
      }
      if (trainer && trainer !== mockTrainerRef.current) await trainer.disconnect();
      await mockTrainerRef.current.connect();
      setTrainer(mockTrainerRef.current);
      setIsMock(true);
      setIsConnectOpen(false);
    } catch (err: any) {
      setConnectError(err.message || 'Failed to launch simulator.');
    } finally {
      setIsConnecting(false);
    }
  };

  const applyTrainerControl = async (
    mode: TrainerControlMode = controlMode,
    targetWatts: number = ergTargetWatts,
    controller: ITrainer | null = trainer,
  ) => {
    if (!controller || !controller.isConnected || controller.connectionStatus.state !== 'connected') return;

    if (controller.activityType === 'running') { setControlError(null); return; }
    if (!controller.capabilities.control) {
      setControlError('Telemetry is connected, but trainer resistance control is unavailable. This ride will still be recorded.');
      return;
    }

    try {
      if (mode === 'erg') {
        if (controller.capabilities.targetPower === false) {
          throw new Error(`${controller.deviceName} does not advertise FTMS ERG target-power support.`);
        }
        await controller.setTargetPower(targetWatts);
        lastErgTargetRef.current = targetWatts;
      } else {
        if (controller.capabilities.simulation === false) {
          throw new Error(`${controller.deviceName} does not advertise FTMS route-simulation support.`);
        }
        const grade = latestTelemetryRef.current.gradePercent * (trainerDifficulty / 100);
        await controller.setGrade(grade);
        lastResistanceGradeRef.current = grade;
      }
      setControlError(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : 'Trainer control command failed.');
    }
  };

  const startRideJournal = async (route: RouteModel, sport: 'cycling' | 'running' = trainer?.activityType ?? 'cycling'): Promise<boolean> => {
    try {
      if (sport === 'cycling') await rideJournal.startSession(route, controlMode, ergTargetWatts, selectedGhost?.id);
      else await rideJournal.startSession(route, controlMode, ergTargetWatts, selectedGhost?.id, sport);
      sessionSportRef.current = sport;
      setDemoGhost(null);
      setRaceGhost(selectedGhost);
      setRideLifecycleError(null);
      return true;
    } catch (error) {
      console.error('[RideJournal] Could not start ride:', error);
      rideStateRef.current = 'idle';
      setRideState('idle');
      setRideLifecycleError('Could not start the ride journal. Your ride has not started; check browser storage and try again.');
      return false;
    }
  };

  const resetRideProgress = (route: RouteModel) => {
    const initialPoint = route.points[0];
    physicsEngineRef.current.reset();
    totalDistanceRef.current = 0;
    elapsedMillisecondsRef.current = 0;
    elapsedSecondsRef.current = 0;
    routeFinishedRef.current = false;
    lastResistanceGradeRef.current = null;
    lastErgTargetRef.current = null;
    pendingResistanceGradeRef.current = null;
    pendingErgTargetRef.current = null;
    setElapsedSeconds(0);
    setTotalDistanceMeters(0);
    setWattsHistory([]);
    setCurrentRoutePoint(initialPoint);
    currentRoutePointRef.current = initialPoint;
    const initialTelemetry = {
      ...INITIAL_TELEMETRY,
      timestamp: isTreadmill ? latestTelemetryRef.current.timestamp : Date.now(),
      flywheelSpeedKph: isTreadmill ? latestTelemetryRef.current.flywheelSpeedKph : 0,
      treadmillInclinePercent: isTreadmill ? latestTelemetryRef.current.treadmillInclinePercent : undefined,
      heartRateBpm: isTreadmill ? latestTelemetryRef.current.heartRateBpm : undefined,
      gradePercent: initialPoint.grade,
      elevationMeters: initialPoint.elevation,
      lat: initialPoint.lat,
      lng: initialPoint.lng,
    };
    setTelemetry(initialTelemetry);
    latestTelemetryRef.current = initialTelemetry;
  };

  const handleSelectRoute = (route: RouteModel) => {
    routeInteractedRef.current = true;
    setSelectedGhostId('');
    setRaceGhost(null);
    setSelectedRoute(route);
    if (route.synthetic) setRideViewMode('scenic');
    selectedRouteRef.current = route;
  };

  // Instant simulator launcher for the course the rider actually selected.
  const handleQuickDemoRide = async () => {
    routeInteractedRef.current = true;
    const route = selectedRouteRef.current;
    resetRideProgress(route);

    if (!mockTrainerRef.current) {
      mockTrainerRef.current = new MockTrainer();
    }
    if (trainer && trainer !== mockTrainerRef.current) {
      await neutralizeTrainer(trainer);
      await trainer.disconnect();
    }
    await mockTrainerRef.current.connect();
    mockTrainerRef.current.setPower(220);
    mockTrainerRef.current.setCadence(90);

    setTrainer(mockTrainerRef.current);
    setIsMock(true);
    setMockWatts(220);
    setMockCadence(90);
    setShowSimulatorBar(false);

    if (!(await startRideJournal(route, 'cycling'))) return;
    rideStateRef.current = 'riding';
    setRideState('riding');
    await applyTrainerControl(controlMode, ergTargetWatts, mockTrainerRef.current);
    await wakeLockManager.requestWakeLock();
  };

  // A launch link starts only after storage has ruled out an unfinished ride.
  // Consume before awaiting so rerenders and StrictMode cannot start two journals.
  useEffect(() => {
    if (!demoLaunchRequested.current || demoLaunchConsumed.current || !recoveryChecked || !hasLoadedRoutePreference) return;
    demoLaunchConsumed.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('demo');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    if (unrecoveredSession || rideState !== 'idle' || routeInteractedRef.current) return;
    const demoRoute = PRESET_ROUTES.find(route => route.id === 'central_park') ?? PRESET_ROUTES[0];
    handleSelectRoute(demoRoute);
    setRideViewMode('scenic');
    setScenicTheme('deathisland');
    void handleQuickDemoRide().then(() => {
      if (rideStateRef.current !== 'riding') return;
      setDemoGhost(buildDemoGhost(demoRoute, riderWeightKg));
      setDemoGhostEnabled(true);
    }).catch(() => setRideLifecycleError('Could not start the demo. Choose Demo Selected Route to try again.'));
  }, [recoveryChecked, hasLoadedRoutePreference, unrecoveredSession, rideState]);

  const handleDisconnect = async () => {
    if (trainer) {
      const wasActiveRide = rideState === 'riding' || rideState === 'paused';
      if (wasActiveRide) {
        rideStateRef.current = 'paused';
        setRideState('paused');
      }
      await neutralizeTrainer();
      if (wasActiveRide) {
        let session: SavedRideSession | null;
        try {
          session = await rideJournal.endSession(
            elapsedMillisecondsRef.current / 1000,
            { ...latestTelemetryRef.current, timestamp: Date.now() },
          );
        } catch (error) {
          console.error('[RideJournal] Could not finish ride before disconnect:', error);
          setControlError('Could not save the finished ride. The recoverable journal is still on this device; press Finish to retry before disconnecting.');
          wakeLockManager.releaseWakeLock();
          return;
        }
        if (session) {
          setCompletedSession(session);
          setIsSummaryOpen(true);
        }
      }
      await trainer.disconnect();
      setTrainer(null);
      trainerConnectionRef.current = { state: 'disconnected' };
      setTrainerConnection({ state: 'disconnected' });
      rideStateRef.current = wasActiveRide ? 'finished' : 'idle';
      setRideState(rideStateRef.current);
      wakeLockManager.releaseWakeLock();
    }
  };

  const handleStartRide = async () => {
    routeInteractedRef.current = true;
    resetRideProgress(selectedRoute);
    if (!(await startRideJournal(selectedRoute))) return;
    rideStateRef.current = 'riding';
    setRideState('riding');
    await applyTrainerControl(controlMode, ergTargetWatts);
    await wakeLockManager.requestWakeLock();
  };

  startRideNowRef.current = () => {
    void handleStartRide();
  };
  resumeRideNowRef.current = () => {
    void handleResumeRide();
  };
  blockingModalOpenRef.current = isEndRideOpen || isSummaryOpen || isRecoveryOpen || isConnectOpen;

  const handleArmRide = () => {
    routeInteractedRef.current = true;
    resetRideProgress(selectedRoute);
    armedTriggerFiredRef.current = false;
    isArmedRef.current = true;
    setIsArmed(true);
  };

  const handleDisarmRide = () => {
    isArmedRef.current = false;
    setIsArmed(false);
  };

  // If the trainer drops while armed, return to the normal idle screen.
  useEffect(() => {
    if (isArmed && !trainer) handleDisarmRide();
  }, [isArmed, trainer]);

  // Dev-only ride beacon: stream live telemetry to the dev server so the ride
  // can be monitored from the terminal. Stripped from production builds.
  useEffect(() => {
    if (!import.meta.env.DEV || import.meta.env.VITE_RIDE_TELEMETRY !== '1') return;
    const intervalId = setInterval(() => {
      const t = latestTelemetryRef.current;
      const payload = JSON.stringify({
        ts: Date.now(),
        rideState: rideStateRef.current,
        armed: isArmedRef.current,
        elapsedSeconds: elapsedSecondsRef.current,
        distanceMeters: Math.round(totalDistanceRef.current),
        powerWatts: t.powerWatts,
        cadenceRpm: t.cadenceRpm,
        gradePercent: Number(t.gradePercent.toFixed(1)),
        heartRateBpm: t.heartRateBpm ?? null,
        trainerState: trainerConnectionRef.current.state,
      });
      void fetch('/__telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).catch(() => {});
    }, 1000);
    return () => clearInterval(intervalId);
  }, []);

  const handlePauseRide = async () => {
    pauseQuietRef.current = false;
    rideStateRef.current = 'paused';
    setRideState('paused');
    await neutralizeTrainer();
  };

  const handleResumeRide = async () => {
    if (routeFinishedRef.current) {
      setControlError('This route is complete. Finish the ride to save it.');
      return;
    }
    // The controller can finish pairing before React's connection subscription
    // has committed its next render. Match the authoritative control-path check.
    if (!trainer || !trainer.isConnected || trainer.connectionStatus.state !== 'connected') {
      setControlError('Connect the trainer before resuming this ride.');
      return;
    }
    if (trainer && sessionSportRef.current !== (trainer.activityType ?? 'cycling')) {
      setControlError('Reconnect the same equipment type that recorded this activity before resuming.');
      return;
    }
    if (trainer?.activityType === 'running' && (!hasFreshTrainerTelemetry(latestTelemetryRef.current, trainerConnectionRef.current.state, Date.now()) || latestTelemetryRef.current.flywheelSpeedKph <= 0)) {
      setControlError('Start the belt on the treadmill console and wait for a fresh speed reading before pressing Resume.');
      return;
    }
    await applyTrainerControl(controlMode, ergTargetWatts);
    rideStateRef.current = 'riding';
    setRideState('riding');
    await wakeLockManager.requestWakeLock();
  };

  const handleEndRide = async () => {
    setIsEndRideOpen(false);
    rideStateRef.current = 'paused';
    setRideState('paused');
    await neutralizeTrainer();
    wakeLockManager.releaseWakeLock();
    let session: SavedRideSession | null;
    try {
      session = await rideJournal.endSession(
        elapsedMillisecondsRef.current / 1000,
        { ...latestTelemetryRef.current, timestamp: Date.now() },
      );
    } catch (error) {
      console.error('[RideJournal] Could not finish ride:', error);
      setControlError('Could not save the finished ride. Your recoverable journal is intact; press Finish to retry.');
      return;
    }
    rideStateRef.current = 'finished';
    setRideState('finished');
    setControlError(null);
    if (session) {
      setCompletedSession(session);
      setIsSummaryOpen(true);
    }
  };

  const handleResetRide = () => {
    rideStateRef.current = 'idle';
    setRideState('idle');
    setRaceGhost(null);
    setDemoGhost(null);
    setElapsedSeconds(0);
    elapsedMillisecondsRef.current = 0;
    elapsedSecondsRef.current = 0;
    setTotalDistanceMeters(0);
    totalDistanceRef.current = 0;
    routeFinishedRef.current = false;
    setWattsHistory([]);
    if (selectedRoute && selectedRoute.points.length > 0) {
      setCurrentRoutePoint(selectedRoute.points[0]);
    }
    setIsSummaryOpen(false);
    setCompletedSession(null);
    setControlError(null);
    setRideLifecycleError(null);
    physicsEngineRef.current.reset();
  };

  const handleReturnHome = () => {
    handleResetRide();
  };

  const handleRideAgain = async () => {
    const route = selectedRouteRef.current;
    setIsSummaryOpen(false);
    setCompletedSession(null);
    resetRideProgress(route);
    if (!trainer || !trainer.isConnected || trainer.connectionStatus.state !== 'connected') {
      rideStateRef.current = 'idle';
      setRideState('idle');
      setControlError('Reconnect your trainer before starting another ride.');
      return;
    }
    if (!(await startRideJournal(route))) return;
    rideStateRef.current = 'riding';
    setRideState('riding');
    await applyTrainerControl(controlMode, ergTargetWatts);
    await wakeLockManager.requestWakeLock();
  };

  const handleRequestHome = async () => {
    rideStateBeforeExitRef.current = rideState;
    if (rideState === 'riding') {
      rideStateRef.current = 'paused';
      setRideState('paused');
    }
    await neutralizeTrainer();
    wakeLockManager.releaseWakeLock();
    setIsEndRideOpen(true);
  };

  const handleKeepRiding = async () => {
    setIsEndRideOpen(false);
    if (rideStateBeforeExitRef.current !== 'riding') return;
    if (!trainer || !trainer.isConnected || trainer.connectionStatus.state !== 'connected') {
      setControlError('Reconnect the trainer before continuing.');
      return;
    }
    if (trainer && sessionSportRef.current !== (trainer.activityType ?? 'cycling')) {
      setControlError('Reconnect the same equipment type that recorded this activity before resuming.');
      return;
    }
    if (trainer?.activityType === 'running' && (!hasFreshTrainerTelemetry(latestTelemetryRef.current, trainerConnectionRef.current.state, Date.now()) || latestTelemetryRef.current.flywheelSpeedKph <= 0)) {
      setControlError('Start the belt on the treadmill console and wait for a fresh speed reading before pressing Resume.');
      return;
    }
    await applyTrainerControl(controlMode, ergTargetWatts);
    rideStateRef.current = 'riding';
    setRideState('riding');
    await wakeLockManager.requestWakeLock();
  };

  const handleDiscardAndReturnHome = async () => {
    setIsEndRideOpen(false);
    await neutralizeTrainer();
    await rideJournal.clearUnfinishedSession();
    wakeLockManager.releaseWakeLock();
    handleReturnHome();
  };

  // Crash Recovery Handlers
  const handleResumeRecovered = async () => {
    if (!unrecoveredSession) return;
    routeInteractedRef.current = true;
    const restoredRoute = unrecoveredSession.route ?? selectedRoute;
    let recoveredGhost: GhostRide | null = null;
    if (unrecoveredSession.raceAgainstId) {
      try {
        const previous = await loadPreviousRide(unrecoveredSession.raceAgainstId);
        recoveredGhost = previous ? buildGhost(previous, restoredRoute) : null;
      } catch { /* Restore the ride even if its previous opponent cannot be read. */ }
      if (!recoveredGhost) setRideLifecycleError('Ride restored without its ghost: the previous ride is unavailable.');
    }
    setRaceGhost(recoveredGhost);
    setSelectedGhostId(recoveredGhost?.id ?? '');
    const lastSample = unrecoveredSession.samples[unrecoveredSession.samples.length - 1];
    const progress = getInterpolatedProgress(restoredRoute, unrecoveredSession.totalDistanceMeters);
    setSelectedRoute(restoredRoute);
    if (restoredRoute.synthetic) setRideViewMode('scenic');
    selectedRouteRef.current = restoredRoute;
    setCurrentRoutePoint(progress.currentPoint);
    currentRoutePointRef.current = progress.currentPoint;
    setTotalDistanceMeters(unrecoveredSession.totalDistanceMeters);
    totalDistanceRef.current = unrecoveredSession.totalDistanceMeters;
    setElapsedSeconds(Math.floor(unrecoveredSession.activeTimerSeconds));
    sessionSportRef.current = unrecoveredSession.sport ?? 'cycling';
    elapsedMillisecondsRef.current = unrecoveredSession.activeTimerSeconds * 1000;
    elapsedSecondsRef.current = Math.floor(unrecoveredSession.activeTimerSeconds);
    setControlMode(unrecoveredSession.controlMode);
    setErgTargetWatts(unrecoveredSession.ergTargetWatts);
    setWattsHistory(unrecoveredSession.samples.map((sample) => sample.powerWatts));
    const restoredTelemetry: TelemetrySample = {
      ...(lastSample ?? INITIAL_TELEMETRY),
      distanceMeters: unrecoveredSession.totalDistanceMeters,
      gradePercent: progress.currentPoint.grade,
      elevationMeters: progress.currentPoint.elevation,
      lat: progress.currentPoint.lat,
      lng: progress.currentPoint.lng,
    };
    setTelemetry(restoredTelemetry);
    latestTelemetryRef.current = restoredTelemetry;
    physicsEngineRef.current.restore(restoredTelemetry.virtualSpeedKph, restoredTelemetry.powerWatts);
    routeFinishedRef.current = progress.isFinished;
    setIsRecoveryOpen(false);
    if (progress.isFinished) {
      rideStateRef.current = 'paused';
      setRideState('paused');
      void handleEndRide();
      return;
    }
    const canResume = trainer?.isConnected && trainer.connectionStatus.state === 'connected'
      && sessionSportRef.current === (trainer.activityType ?? 'cycling') && sessionSportRef.current !== 'running';
    rideStateRef.current = canResume ? 'riding' : 'paused';
    setRideState(canResume ? 'riding' : 'paused');
    if (canResume) {
      void applyTrainerControl(unrecoveredSession.controlMode, unrecoveredSession.ergTargetWatts);
      void wakeLockManager.requestWakeLock();
    } else {
      setControlError('Ride restored. Connect your trainer, then press Resume.');
    }
  };

  const handleDiscardRecovered = async () => {
    await rideJournal.clearUnfinishedSession();
    setUnrecoveredSession(null);
    setIsRecoveryOpen(false);
  };

  // Mock Sliders Handlers
  const handleMockWattsChange = (w: number) => {
    setMockWatts(w);
    if (mockTrainerRef.current) mockTrainerRef.current.setPower(w);
  };

  const handleMockCadenceChange = (rpm: number) => {
    setMockCadence(rpm);
    if (mockTrainerRef.current) mockTrainerRef.current.setCadence(rpm);
  };

  const handleControlModeChange = async (mode: TrainerControlMode) => {
    if (!trainer?.capabilities.control) {
      setControlError('Trainer resistance control is unavailable. You can still record a telemetry-only ride.');
      return;
    }
    if (mode === 'route' && trainer.capabilities.simulation === false) {
      setControlError(`${trainer.deviceName} does not advertise FTMS route-simulation support.`);
      return;
    }
    if (mode === 'erg' && trainer?.capabilities.targetPower === false) {
      setControlError(`${trainer.deviceName} does not advertise FTMS ERG target-power support.`);
      return;
    }

    let target = ergTargetWatts;
    if (mode === 'erg' && telemetry.powerWatts >= 50) {
      target = Math.max(50, Math.min(600, Math.round(telemetry.powerWatts / 5) * 5));
      setErgTargetWatts(target);
    }
    setControlMode(mode);
    setControlError(null);
    await rideJournal.updateControlMode(mode, target);
    if (rideState === 'riding') {
      await applyTrainerControl(mode, target);
    }
  };

  const handleErgTargetChange = async (watts: number) => {
    const target = Math.max(50, Math.min(600, Math.round(watts / 5) * 5));
    setErgTargetWatts(target);
    lastErgTargetRef.current = null;
    await rideJournal.updateControlMode(controlMode, target);
    if (rideState === 'riding' && controlMode === 'erg') {
      await applyTrainerControl('erg', target);
    }
  };

  const handleScenicStyleChange = (style: 'cinematic' | 'toy') => {
    const currentOption = SCENIC_THEME_OPTIONS.find((theme) => theme.id === scenicTheme);
    const currentStyle = currentOption?.group === 'Cinematic worlds' ? 'cinematic' : 'toy';
    if (currentStyle === style) return;
    setScenicTheme(style === 'cinematic' ? 'deathisland' : 'daybreak');
  };

  const handleConnectHeartRate = async () => {
    try {
      const monitor = hrMonitorRef.current ?? new BleHeartRateMonitor();
      hrMonitorRef.current = monitor;
      monitor.onHeartRate((bpm) => {
        if (bpm === null) {
          setHrDeviceName(null);
          latestTelemetryRef.current = { ...latestTelemetryRef.current, heartRateBpm: undefined };
          return;
        }
        latestTelemetryRef.current = { ...latestTelemetryRef.current, heartRateBpm: bpm };
      });
      await monitor.connect();
      setHrDeviceName(monitor.deviceName);
    } catch (error) {
      // A cancelled chooser is not an error worth surfacing.
      if ((error as { name?: string })?.name !== 'NotFoundError') {
        setControlError(error instanceof Error ? error.message : 'Could not connect the heart rate monitor.');
      }
    }
  };

  const handleDisconnectHeartRate = async () => {
    await hrMonitorRef.current?.disconnect();
    setHrDeviceName(null);
  };

  const handleRetryTrainer = async () => {
    if (!trainer) return;
    setControlError(null);
    try {
      await trainer.reconnect();
    } catch (error) {
      setControlError(error instanceof Error ? error.message : 'Could not reconnect to the trainer.');
    }
  };

  const avgWatts = wattsHistory.length > 0
    ? wattsHistory.reduce((a, b) => a + b, 0) / wattsHistory.length
    : telemetry.powerWatts;
  const trainerConnected = Boolean(
    trainer
    && trainer.isConnected
    && trainerConnection.state === 'connected',
  );
  const trainerControlReady = Boolean(trainerConnected && trainer?.capabilities.control);
  const isActiveRide = rideState === 'riding' || rideState === 'paused';
  const routeControlAvailable = Boolean(trainerControlReady && trainer?.capabilities.simulation !== false);
  const ergControlAvailable = Boolean(trainerControlReady && trainer?.capabilities.targetPower !== false);
  const scenicStyle = SCENIC_THEME_OPTIONS.find((theme) => theme.id === scenicTheme)?.group === 'Cinematic worlds'
    ? 'cinematic'
    : 'toy';

  return (
    <div className="h-screen w-screen bg-background text-slate-100 flex flex-col justify-between p-3 md:p-5 overflow-hidden">
      {/* Top Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-2 w-full z-20 shrink-0 mb-2">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <div className="w-8 h-8 md:w-9 md:h-9 shrink-0 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white font-black">
            <Activity className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="flex-wrap text-sm md:text-lg font-black tracking-tight text-white flex items-center gap-1.5 md:gap-2">
              TOUR DE HOME <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">V1</span>
            </h1>
            <p className="hidden sm:block text-[11px] text-slate-400">Ride Anywhere From Home</p>
          </div>
        </div>

        {/* Status / Connect / Controls */}
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2 md:gap-3">
          {rideState === 'idle' && (
            <button
              onClick={handleQuickDemoRide}
              className="hidden sm:flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all active:scale-95 animate-pulse"
            >
              <Sparkles className="w-4 h-4 fill-current" />
              Demo Selected Route
            </button>
          )}

          {isMock && (
            <button
              onClick={() => setShowSimulatorBar((prev) => !prev)}
              aria-label={showSimulatorBar ? 'Hide simulator controls' : 'Show simulator controls'}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-cyan-800/60 bg-slate-800 p-2 text-xs font-semibold text-cyan-300 transition-all hover:bg-slate-700 sm:px-3 sm:py-1.5"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{showSimulatorBar ? 'Hide Controls' : 'Show Controls'}</span>
            </button>
          )}

          {trainer && isActiveRide ? (
            <div
              aria-label={`Trainer status: ${trainerConnected
                ? trainerControlReady
                  ? isMock ? 'Simulator Active' : 'FTMS + resistance ready'
                  : (isTreadmill ? 'Treadmill sync · use console' : 'Telemetry only · no resistance')
                : trainerConnection.message ?? (trainerConnection.state === 'failed' ? 'Connection failed' : 'Reconnecting…')}`}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-card/80 px-3 py-1.5 shadow-xl backdrop-blur-md"
            >
              <span className={`inline-flex h-2 w-2 rounded-full ${
                trainerControlReady ? 'bg-emerald-500' : trainerConnection.state === 'failed' ? 'bg-red-500' : 'bg-amber-500'
              }`}></span>
              <span className="max-w-[120px] truncate text-[11px] font-bold text-slate-200">{isMock ? 'Simulator' : trainer.deviceName}</span>
              {trainerConnection.state === 'failed' && (
                <button
                  onClick={handleRetryTrainer}
                  className="rounded-lg bg-red-500 px-2.5 py-1 text-[10px] font-black text-white hover:bg-red-400"
                >
                  Retry
                </button>
              )}
            </div>
          ) : trainer ? (
            <div className={`flex min-w-0 max-w-[148px] items-center gap-1.5 rounded-xl border bg-card/90 px-2 py-1.5 shadow-xl backdrop-blur-md sm:max-w-none sm:gap-3 sm:px-3.5 ${
              trainerControlReady
                ? 'border-emerald-500/30'
                : trainerConnected
                  ? 'border-amber-500/40'
                : trainerConnection.state === 'failed'
                  ? 'border-red-500/40'
                  : 'border-amber-500/40'
            }`}>
              <span className="flex h-2 w-2 relative">
                {(trainerConnected || trainerConnection.state === 'reconnecting') && (
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${trainerControlReady ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                )}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${
                  trainerControlReady ? 'bg-emerald-500' : trainerConnection.state === 'failed' ? 'bg-red-500' : 'bg-amber-500'
                }`}></span>
              </span>
              <div className="min-w-0 text-left">
                <div className="flex items-center gap-1 truncate text-[10px] font-bold text-white sm:text-xs">
                  <span className="truncate">{isMock ? 'Simulator' : trainer.deviceName}</span>
                  {trainerControlReady && <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
                </div>
                <div className={`hidden text-[10px] font-medium sm:block ${
                  trainerControlReady ? 'text-emerald-400' : trainerConnection.state === 'failed' ? 'text-red-400' : 'text-amber-400'
                }`}>
                  {trainerConnected
                    ? trainerControlReady
                      ? isMock ? 'Simulator Active' : 'FTMS + resistance ready'
                      : (isTreadmill ? 'Treadmill sync · use console' : 'Telemetry only · no resistance')
                    : trainerConnection.message ?? (trainerConnection.state === 'failed' ? 'Connection failed' : 'Reconnecting…')}
                </div>
              </div>
              {trainerConnection.state === 'failed' && (
                <button
                  onClick={handleRetryTrainer}
                  className="ml-2 rounded-lg bg-red-500 px-2.5 py-1 text-[10px] font-black text-white hover:bg-red-400"
                >
                  Retry
                </button>
              )}
              <button
                onClick={handleDisconnect}
                aria-label="Disconnect trainer"
                className="shrink-0 text-xs text-slate-400 transition-colors hover:text-red-400"
              >
                <X className="h-4 w-4 sm:hidden" />
                <span className="hidden sm:inline">Disconnect</span>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsConnectOpen(true)}
              className="flex items-center gap-1.5 px-3 md:px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-cyan-500/25 transition-all duration-200 active:scale-95"
            >
              <Bluetooth className="w-4 h-4" />
              Connect<span className="hidden sm:inline"> Trainer</span>
            </button>
          )}

          {!isActiveRide && (
            hrDeviceName ? (
              <div className="flex items-center gap-2 rounded-full border border-rose-400/30 bg-card/80 px-3 py-1.5 shadow-xl backdrop-blur-md">
                <Heart className="h-3.5 w-3.5 fill-current text-rose-400" />
                <span className="max-w-[110px] truncate text-[11px] font-bold text-slate-200">{hrDeviceName}</span>
                <button
                  onClick={handleDisconnectHeartRate}
                  aria-label="Disconnect heart rate monitor"
                  className="text-slate-400 transition-colors hover:text-rose-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnectHeartRate}
                aria-label="Connect heart rate monitor"
                className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-card/80 px-3 py-2 text-xs font-bold text-slate-300 shadow-lg backdrop-blur-md transition-all hover:border-rose-400/40 hover:text-rose-300 active:scale-95"
              >
                <Heart className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">HR</span>
              </button>
            )
          )}
        </div>
      </header>

      {/* Main App Body */}
      <main className="flex-1 w-full flex flex-col justify-between gap-2.5 overflow-hidden">
        {rideState === 'idle' && !isArmed ? (
          /* Pre-Ride Launch Screen */
          <div className="w-full max-w-7xl mx-auto flex-1 flex flex-col justify-start gap-5 overflow-y-auto pr-1 pt-1">
            <RoutePicker
              selectedRoute={selectedRoute}
              onSelectRoute={handleSelectRoute}
            />

            <FitImport importedRides={previousRides.filter(ride => ride.importedFromFit && ride.route)}
              onSelect={ride => { handleSelectRoute(ride.route!); setSelectedGhostId(ride.id); }}
              onImported={ride => {
                setHistoryReload(value => value + 1);
                setPreviousRides(previous => [ride, ...previous.filter(r => r.id !== ride.id)]);
                handleSelectRoute(ride.route!); setSelectedGhostId(ride.id);
              }} />
            <RacePicker ghosts={ghosts} selectedId={selectedGhost?.id ?? ''} onSelect={setSelectedGhostId}
              loading={historyLoading} error={historyError} onRetry={() => setHistoryReload(value => value + 1)} />

            <div className="flex flex-wrap items-center justify-center gap-3 md:gap-4">
              <label className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-xs font-bold text-slate-300">
                Rider
                <input
                  aria-label="Rider weight in kilograms"
                  type="number"
                  min="35"
                  max="200"
                  step="1"
                  value={riderWeightKg}
                  onChange={(event) => setRiderWeightKg(Math.max(35, Math.min(200, Number(event.target.value) || 75)))}
                  className="w-14 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-center font-mono text-sm text-white outline-none focus:border-cyan-400"
                />
                kg
              </label>

                  <button
                    onClick={handleArmRide}
                    disabled={!trainerConnected}
                    className="flex min-w-0 max-w-full items-center justify-center gap-2 px-4 sm:px-8 py-4 bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-black text-lg rounded-2xl shadow-2xl shadow-cyan-500/30 transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Play className="w-6 h-6 fill-current" />
                    LOAD COURSE
                  </button>

                  <button
                    onClick={handleQuickDemoRide}
                    className="flex min-w-0 max-w-full items-center justify-center gap-2 px-3 sm:px-6 py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-base rounded-2xl shadow-xl shadow-amber-500/20 transition-all active:scale-95"
                  >
                    <Sparkles className="w-5 h-5 fill-current" />
                    Demo Selected Route
                  </button>
            </div>

            {!trainerConnected && (
              <p className="text-center text-xs text-slate-400">
                Use <strong>Demo Selected Route</strong> with the simulator, or connect an <strong>FTMS trainer or treadmill</strong>.
              </p>
            )}
            {rideLifecycleError && (
              <p role="alert" className="rounded-xl border border-red-500/30 bg-red-950/60 px-4 py-2 text-center text-xs text-red-200">
                {rideLifecycleError}
              </p>
            )}
          </div>
        ) : (
          /* Active Ride Screen (HUD + 3D Map + Elevation Ribbon) */
          <div className="flex-1 min-h-0 flex flex-col gap-2.5 w-full h-full overflow-y-auto">
            {rideLifecycleError && <p role="alert" className="shrink-0 rounded-xl bg-amber-950/70 px-3 py-2 text-sm text-amber-100">{rideLifecycleError}</p>}
            {demoGhost && isMock && <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-400/30 bg-slate-950/90 px-3 py-2">
              <span className="text-xs text-violet-200">Race Yourself · sample opponent, not a recorded ride</span>
              <button type="button" role="switch" aria-checked={demoGhostEnabled} aria-label="Demo ghost"
                onClick={() => setDemoGhostEnabled(value => !value)}
                className="min-h-11 rounded-lg border border-violet-400/50 px-4 text-sm font-semibold text-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
                Demo ghost: {demoGhostEnabled ? 'On' : 'Off'}
              </button>
            </div>}
            {raceGhost && <RaceHud ghost={raceGhost} seconds={elapsedMillisecondsRef.current / 1000}
              distance={totalDistanceMeters} paused={rideState !== 'riding'} totalDistance={selectedRoute.totalDistanceMeters} />}
            {/* The detailed dashboard belongs to Map Mode; Scenic uses a glass cockpit overlay. */}
            {isTreadmill && <TreadmillHud sample={telemetry} seconds={elapsedSeconds} distance={totalDistanceMeters} paused={rideState !== 'riding'} />}
            {isTreadmill && controlError && <p role="status" className="text-sm text-amber-200">{controlError}</p>}
            {rideViewMode === 'map' && !isTreadmill && (
              <div className="shrink-0">
                <HUD
                  telemetry={telemetry}
                  elapsedSeconds={elapsedSeconds}
                  totalDistanceMeters={totalDistanceMeters}
                  averageWatts={avgWatts}
                  trainerDifficulty={trainerDifficulty}
                  onDifficultyChange={setTrainerDifficulty}
                  controlMode={controlMode}
                  ergTargetWatts={ergTargetWatts}
                  routeAvailable={routeControlAvailable}
                  ergAvailable={ergControlAvailable}
                  trainerControlReady={trainerControlReady}
                  controlError={controlError}
                  onControlModeChange={handleControlModeChange}
                  onErgTargetChange={handleErgTargetChange}
                />
              </div>
            )}

              {/* Ride actions stay in document flow so zoom cannot obscure the race gap. */}
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {rideState === 'riding' && (
                  <button
                    onClick={handlePauseRide}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/85 hover:bg-slate-800 text-amber-400 border border-amber-500/30 font-bold text-xs rounded-xl shadow-lg backdrop-blur-md transition-all active:scale-95"
                  >
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    Pause (Space)
                  </button>
                )}

                {rideState === 'paused' && (
                  <>
                    <button
                      onClick={handleResumeRide}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition-all active:scale-95"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Resume
                    </button>
                    <button
                      onClick={handleEndRide}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-400 text-white font-bold text-xs rounded-xl shadow-lg transition-all active:scale-95"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      Finish
                    </button>
                  </>
                )}
                {(rideViewMode !== 'scenic' || scenicControlsOpen) && (
                <button
                  type="button"
                  onClick={handleRequestHome}
                  className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-slate-950/85 px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-md transition-all hover:bg-slate-800 active:scale-95"
                  aria-label="End ride and return home"
                >
                  <Home className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Home</span>
                </button>
                )}
                {rideViewMode === 'scenic' && scenicControlsOpen && trainer && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  aria-label="Disconnect trainer"
                  className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-slate-950/85 px-3 py-1.5 text-xs font-bold text-slate-300 shadow-lg backdrop-blur-md transition-all hover:text-red-400 active:scale-95"
                >
                  Disconnect
                </button>
                )}
              </div>

            {/* Center: accurate route map or generative first-person road */}
            <div className={`flex-1 w-full relative ${rideViewMode === 'scenic' ? 'min-h-[32rem] sm:min-h-[300px]' : 'min-h-[140px]'}`}>
              {rideViewMode === 'scenic' ? (
                <>
                  <Suspense fallback={<div className="h-full w-full animate-pulse rounded-3xl border border-cardBorder bg-gradient-to-b from-slate-800 to-slate-950" />}>
                    <ScenicRide
                      route={selectedRoute}
                      distanceMeters={totalDistanceMeters}
                      ghostDistanceMeters={raceGhost ? ghostDistanceAt(raceGhost, elapsedMillisecondsRef.current / 1000) : undefined}
                      speedKph={telemetry.virtualSpeedKph}
                      cadenceRpm={telemetry.cadenceRpm}
                      isPaused={rideState === 'paused'}
                      theme={scenicTheme}
                      qualityMode={scenicQualityMode}
                    />
                  </Suspense>
                  {!isTreadmill && <ScenicHud
                    telemetry={telemetry}
                    elapsedSeconds={elapsedSeconds}
                    totalDistanceMeters={totalDistanceMeters}
                    averageWatts={avgWatts}
                    trainerDifficulty={trainerDifficulty}
                    onDifficultyChange={setTrainerDifficulty}
                    controlMode={controlMode}
                    ergTargetWatts={ergTargetWatts}
                    routeAvailable={routeControlAvailable}
                    ergAvailable={ergControlAvailable}
                    trainerControlReady={trainerControlReady}
                    controlError={controlError}
                    onControlModeChange={handleControlModeChange}
                    onErgTargetChange={handleErgTargetChange}
                    controlsOpen={scenicControlsOpen}
                    onToggleControls={() => setScenicControlsOpen((open) => !open)}
                  />}
                  <div className="absolute inset-0 z-10 pointer-events-none">
                    <ScenicClimbBar
                      route={selectedRoute}
                      currentDistanceMeters={totalDistanceMeters}
                    />
                  </div>
                </>
              ) : (
                <Suspense fallback={<div className="h-full w-full animate-pulse rounded-3xl border border-cardBorder bg-slate-900" />}>
                  <Map3D
                    route={selectedRoute}
                    currentPoint={currentRoutePoint}
                    ghostPoint={raceGhost ? getInterpolatedProgress(selectedRoute, ghostDistanceAt(raceGhost, elapsedMillisecondsRef.current / 1000)).currentPoint : null}
                  />
                </Suspense>
              )}

              {(rideViewMode !== 'scenic' || scenicControlsOpen) && (
              <div className={`absolute left-3 right-3 sm:right-auto z-20 flex items-center gap-1 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/72 p-1 shadow-2xl backdrop-blur-xl ${rideViewMode === 'scenic' ? 'top-[220px] sm:top-[190px]' : 'top-3'}`}>
                <button
                  type="button"
                  disabled={selectedRoute.synthetic}
                  title={selectedRoute.synthetic ? 'This indoor activity has no GPS map. Use the virtual scenic course.' : undefined}
                  onClick={() => setRideViewMode('map')}
                  aria-pressed={rideViewMode === 'map'}
                  className={`flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black tracking-wider transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${rideViewMode === 'map' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                >
                  <Map className="h-3.5 w-3.5" /> MAP
                </button>
                <button
                  type="button"
                  onClick={() => setRideViewMode('scenic')}
                  aria-pressed={rideViewMode === 'scenic'}
                  className={`flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black tracking-wider transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${rideViewMode === 'scenic' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                >
                  <Mountain className="h-3.5 w-3.5" /> SCENIC
                </button>

                {rideViewMode === 'scenic' && (
                  <>
                    <span className="mx-0.5 h-5 w-px bg-white/10" />
                    <label className="rounded-lg bg-white/[0.04] px-1 text-cyan-100">
                      <span className="sr-only">Scenic visual style</span>
                      <select
                        value={scenicStyle}
                        onChange={(event) => handleScenicStyleChange(event.target.value as 'cinematic' | 'toy')}
                        aria-label="Scenic visual style"
                        className="min-h-9 w-[76px] cursor-pointer appearance-none rounded-md bg-transparent py-1.5 pl-1 text-[10px] font-black uppercase tracking-wider outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 sm:w-[92px]"
                      >
                        <option value="cinematic" className="bg-slate-950 text-white">Cinema</option>
                        <option value="toy" className="bg-slate-950 text-white">Toy 3D</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1 rounded-lg bg-white/[0.04] px-1.5 text-cyan-200">
                      <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="sr-only">Scenic world</span>
                      <select
                        value={scenicTheme}
                        onChange={(event) => setScenicTheme(event.target.value as ScenicTheme)}
                        aria-label="Scenic world"
                        className="min-h-9 w-[92px] cursor-pointer appearance-none rounded-md bg-transparent py-1.5 pr-1 text-[10px] font-black uppercase tracking-wider text-cyan-100 outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 sm:w-[138px] sm:text-[11px]"
                      >
                        {SCENIC_THEME_OPTIONS
                          .filter((theme) => scenicStyle === 'cinematic'
                            ? theme.group === 'Cinematic worlds'
                            : theme.group === 'Tour de Home')
                          .map((theme) => (
                          <option key={theme.id} value={theme.id} className="bg-slate-950 text-white">
                            {theme.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="rounded-lg bg-white/[0.04] px-1 text-cyan-100">
                      <span className="sr-only">Scenic quality</span>
                      <select
                        value={scenicQualityMode}
                        onChange={(event) => setScenicQualityMode(event.target.value as ScenicQualityMode)}
                        aria-label="Scenic quality"
                        className="min-h-9 w-[72px] cursor-pointer appearance-none rounded-md bg-transparent py-1.5 pl-1 text-[10px] font-black uppercase tracking-wider outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 sm:w-[86px]"
                      >
                        {SCENIC_QUALITY_OPTIONS.map((quality) => (
                          <option key={quality.id} value={quality.id} className="bg-slate-950 text-white">
                            {quality.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
              )}

              {isArmed && (
                <div className="absolute inset-x-0 bottom-32 z-30 flex flex-col items-center gap-3">
                  <div
                    role="status"
                    className="flex items-center gap-3 rounded-2xl border border-cyan-400/50 bg-slate-950/80 px-8 py-4 text-lg font-black text-cyan-200 shadow-2xl shadow-cyan-500/20 backdrop-blur-xl"
                  >
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-cyan-400" />
                    </span>
                    {isTreadmill ? 'Start the belt on your treadmill to begin' : 'Start pedaling to begin'}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        armedTriggerFiredRef.current = true;
                        handleDisarmRide();
                        startRideNowRef.current();
                      }}
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-4 py-2 text-xs font-black text-slate-950 shadow-xl transition-all hover:from-cyan-300 hover:to-emerald-300 active:scale-95"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      Start Now
                    </button>
                    <button
                      onClick={handleDisarmRide}
                      className="rounded-xl border border-slate-600 bg-slate-950/80 px-4 py-2 text-xs font-bold text-slate-300 backdrop-blur-md transition-all hover:border-slate-400 active:scale-95"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}


            </div>

            {/* Map Mode keeps the full analytical elevation panel. */}
            {rideViewMode === 'map' && (
              <div className="shrink-0">
                <ElevationRibbon
                  route={selectedRoute}
                  currentDistanceMeters={totalDistanceMeters}
                  currentPoint={currentRoutePoint}
                />
              </div>
            )}
          </div>
        )}

        {/* Floating Mock Simulator Controls */}
        {isMock && trainerConnected && showSimulatorBar && (
          <div className="shrink-0">
            <MockTrainerControls
              mockTrainer={mockTrainerRef.current!}
              currentWatts={mockWatts}
              currentCadence={mockCadence}
              controlMode={controlMode}
              onWattsChange={handleMockWattsChange}
              onCadenceChange={handleMockCadenceChange}
            />
            <div className="mt-1 flex justify-end">
              <button
                onClick={handleDisconnect}
                aria-label="Disconnect trainer"
                className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-1 text-[10px] font-bold text-slate-400 transition-colors hover:text-red-400"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer Info */}
      {!isActiveRide && (
      <footer className="w-full flex items-center justify-between text-[10px] md:text-[11px] text-slate-500 border-t border-slate-900 pt-2 shrink-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden sm:inline">Tour de Home V1</span>
          <a href={`${import.meta.env.BASE_URL}THIRD-PARTY-NOTICES.txt`} target="_blank" rel="noreferrer" className="shrink-0 underline hover:text-slate-300">Licenses</a>
          <span className="hidden sm:inline">•</span>
          <span className="flex min-w-0 items-center gap-1 truncate">
            <Compass className="w-3 h-3 text-cyan-400" />
            <span className="truncate">{selectedRoute.name}</span>
            <span className="shrink-0">({(selectedRoute.totalDistanceMeters / 1000).toFixed(1)} km)</span>
          </span>
        </div>
        <div className="hidden md:flex items-center gap-4 font-mono">
          <span>Shortcuts: Space=Pause • Esc=Exit menu{!isTreadmill && controlMode === 'route' ? ' • ↑/↓=Difficulty' : ''}</span>
          <span>Web Bluetooth FTMS 0x1826</span>
        </div>
      </footer>
      )}

      {/* Modals */}
      <ConnectModal
        isOpen={isConnectOpen}
        isConnecting={isConnecting}
        error={connectError}
        onConnectTreadmill={handleConnectTreadmill}
        onConnectReal={handleConnectReal}
        onConnectMock={handleConnectMock}
        onClose={() => setIsConnectOpen(false)}
      />

      <SummaryModal
        isOpen={isSummaryOpen}
        session={completedSession}
        raceGhost={raceGhost}
        onHome={handleReturnHome}
        onRideAgain={() => void handleRideAgain()}
      />

      <EndRideModal
        isOpen={isEndRideOpen}
        onSaveAndExit={() => void handleEndRide()}
        onDiscardAndExit={() => void handleDiscardAndReturnHome()}
        onKeepRiding={() => void handleKeepRiding()}
      />

      <CrashRecoveryModal
        isOpen={isRecoveryOpen}
        session={unrecoveredSession}
        onResume={() => void handleResumeRecovered()}
        onExportAndDiscard={handleDiscardRecovered}
        onDiscard={handleDiscardRecovered}
      />
    </div>
  );
}
