import { SavedRideSession } from '../storage/rideJournal';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function exportSessionToTcx(session: SavedRideSession): string {
  const startDate = new Date(session.startTime).toISOString();
  const totalElapsedSeconds = session.endTime
    ? Math.round((session.endTime - session.startTime) / 1000)
    : session.samples.length;
  const activeTimerSeconds = session.activeTimerSeconds > 0 ? session.activeTimerSeconds : totalElapsedSeconds;

  const totalDist = session.totalDistanceMeters;
  const samples = session.samples;

  // Calculate avg/max stats
  let totalWatts = 0;
  let maxWatts = 0;
  let totalCadence = 0;
  let cadenceCount = 0;
  let maxSpeedMps = 0;
  let totalHeartRate = 0;
  let heartRateCount = 0;
  let maxHeartRate = 0;

  for (const s of samples) {
    totalWatts += s.powerWatts;
    if (s.powerWatts > maxWatts) maxWatts = s.powerWatts;
    if (s.cadenceRpm > 0) {
      totalCadence += s.cadenceRpm;
      cadenceCount++;
    }
    if (s.heartRateBpm !== undefined && s.heartRateBpm > 0) {
      const heartRate = Math.max(1, Math.min(255, Math.round(s.heartRateBpm)));
      totalHeartRate += heartRate;
      heartRateCount++;
      maxHeartRate = Math.max(maxHeartRate, heartRate);
    }
    maxSpeedMps = Math.max(maxSpeedMps, s.virtualSpeedKph / 3.6);
  }

  const avgWatts = samples.length > 0 ? Math.round(totalWatts / samples.length) : 0;
  const avgCadence = cadenceCount > 0 ? Math.round(totalCadence / cadenceCount) : 0;
  const heartRateSummaryXml = heartRateCount > 0 ? `
        <AverageHeartRateBpm><Value>${Math.round(totalHeartRate / heartRateCount)}</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>${maxHeartRate}</Value></MaximumHeartRateBpm>` : '';

  let trackpointsXml = '';
  for (const s of samples) {
    const ptTime = new Date(s.timestamp).toISOString();
    let positionXml = '';
    if (!session.route?.synthetic && s.lat !== undefined && s.lng !== undefined && (s.lat !== 0 || s.lng !== 0)) {
      positionXml = `
          <Position>
            <LatitudeDegrees>${s.lat.toFixed(6)}</LatitudeDegrees>
            <LongitudeDegrees>${s.lng.toFixed(6)}</LongitudeDegrees>
          </Position>`;
    }
    const altitudeXml = s.elevationMeters !== undefined ? `<AltitudeMeters>${s.elevationMeters.toFixed(1)}</AltitudeMeters>` : '';
    const heartRateXml = s.heartRateBpm !== undefined && s.heartRateBpm > 0
      ? `<HeartRateBpm><Value>${Math.max(1, Math.min(255, Math.round(s.heartRateBpm)))}</Value></HeartRateBpm>`
      : '';

    trackpointsXml += `
        <Trackpoint>
          <Time>${ptTime}</Time>${positionXml}${altitudeXml}
          <DistanceMeters>${s.distanceMeters.toFixed(1)}</DistanceMeters>
          ${heartRateXml}
          <Cadence>${s.cadenceRpm}</Cadence>
          <Extensions>
            <ns3:TPX xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
              <ns3:Speed>${(s.virtualSpeedKph / 3.6).toFixed(2)}</ns3:Speed>
              <ns3:Watts>${s.powerWatts}</ns3:Watts>
            </ns3:TPX>
          </Extensions>
        </Trackpoint>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Activities>
    <Activity Sport="${session.sport === 'running' ? 'Running' : 'Biking'}">
      <Id>${escapeXml(startDate)}</Id>
      <Lap StartTime="${startDate}">
        <TotalTimeSeconds>${activeTimerSeconds}</TotalTimeSeconds>
        <DistanceMeters>${totalDist.toFixed(1)}</DistanceMeters>
        <MaximumSpeed>${maxSpeedMps.toFixed(2)}</MaximumSpeed>
        <Calories>${Math.round((avgWatts * activeTimerSeconds * 4) / 4184)}</Calories>
        ${heartRateSummaryXml}
        <Intensity>Active</Intensity>
        <Cadence>${avgCadence}</Cadence>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
          ${trackpointsXml}
        </Track>
        <Extensions>
          <ns3:LX xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
            <ns3:AvgSpeed>${(totalDist / Math.max(1, activeTimerSeconds)).toFixed(2)}</ns3:AvgSpeed>
            <ns3:AvgWatts>${avgWatts}</ns3:AvgWatts>
            <ns3:MaxWatts>${maxWatts}</ns3:MaxWatts>
          </ns3:LX>
        </Extensions>
      </Lap>
      <Creator xsi:type="Device_t">
        <Name>Tour de Home Indoor Cycling</Name>
        <UnitId>1826</UnitId>
        <ProductID>1</ProductID>
      </Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

export function downloadTcxFile(session: SavedRideSession) {
  const xml = exportSessionToTcx(session);
  const blob = new Blob([xml], { type: 'application/vnd.garmin.tcx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeRouteName = session.routeName.replace(/[^a-z0-9_-]+/gi, '_');
  a.download = `Tour_de_Home_${new Date(session.startTime).toISOString().slice(0, 10)}_${safeRouteName}.tcx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
