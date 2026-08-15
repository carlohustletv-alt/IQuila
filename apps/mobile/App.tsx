import type { Session } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { Alert, Image, PermissionsAndroid, Platform, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { fetchAssignedFarms, fetchFarmFlocks, fetchMyDailyRecords, pushDailyRecords, type FarmListItem, type Flock, type RemoteDailyRecord } from "./src/api";
import { captureFieldEvidence, fetchVisibleEvidence, getEvidenceQueue, getLocationStatus, syncEvidenceQueue, type LocationStatus, type PendingEvidence, type RemoteEvidence } from "./src/evidence";
import { Logo } from "./src/Logo";
import { ConsoleTabs, ContextSelector, NumberLogger, SelectorChip, type ConsoleTab } from "./src/components/FieldUi";
import { colors } from "./src/theme";
import {
  getDailyRecordsForFarm,
  getPendingDailyRecords,
  initializeOfflineStore,
  applyDailyRecordSyncResults,
  savePendingDailyRecord,
  type PendingDailyRecord
} from "./src/offline";
import { exportRecordsPdf } from "./src/pdf";
import { supabase } from "./src/supabase";

function today() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function id() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function optionalNumber(value: string) {
  if (!value.trim()) return null;
  return Number(value);
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [farms, setFarms] = useState<FarmListItem[]>([]);
  const [flocks, setFlocks] = useState<Flock[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState("");
  const [selectedFlockId, setSelectedFlockId] = useState("");
  const [mortality, setMortality] = useState("0");
  const [feed, setFeed] = useState("");
  const [eggs, setEggs] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("Ready");
  const [pendingCount, setPendingCount] = useState(0);
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [pendingEvidence, setPendingEvidence] = useState<PendingEvidence[]>([]);
  const [capturingEvidence, setCapturingEvidence] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [localRecords, setLocalRecords] = useState<PendingDailyRecord[]>([]);
  const [remoteRecords, setRemoteRecords] = useState<RemoteDailyRecord[]>([]);
  const [remoteEvidence, setRemoteEvidence] = useState<RemoteEvidence[]>([]);
  const [activeTab, setActiveTab] = useState<ConsoleTab>("run");
  const [locationStatus, setLocationStatus] = useState<LocationStatus | null>(null);
  const selectedFarmRef = useRef("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setFarms([]); setFlocks([]); setSelectedFarmId(""); setSelectedFlockId(""); setLocalRecords([]); setRemoteRecords([]); setRemoteEvidence([]); setPendingEvidence([]);
      return;
    }
    initializeOfflineStore().then(refreshPendingCount).catch((error: Error) => setStatus(error.message));
    loadFarms().catch((error: Error) => setStatus(error.message));
    refreshEvidenceQueue().catch((error: Error) => setStatus(error.message));
  }, [session]);

  useEffect(() => {
    selectedFarmRef.current = selectedFarmId;
    if (!selectedFarmId) return;
    setFlocks([]);
    setSelectedFlockId("");
    setRemoteEvidence([]);
    setRemoteRecords([]);
    loadFlocks(selectedFarmId).catch((error: Error) => setStatus(error.message));
    refreshLocalRecords(selectedFarmId).catch((error: Error) => setStatus(error.message));
    refreshRemoteData(selectedFarmId).catch((error: Error) => setStatus(error.message));
  }, [selectedFarmId]);

  useEffect(() => {
    if (activeTab !== "proof") return;
    getLocationStatus().then(setLocationStatus).catch(() => setLocationStatus(null));
  }, [activeTab]);

  async function refreshPendingCount() {
    const records = await getPendingDailyRecords();
    setPendingCount(records.length);
  }

  async function refreshEvidenceQueue() {
    setPendingEvidence(await getEvidenceQueue());
  }

  async function refreshLocalRecords(farmId = selectedFarmId) {
    if (!farmId) return;
    const records = await getDailyRecordsForFarm(farmId);
    if (selectedFarmRef.current !== farmId) return;
    setLocalRecords(records.slice(0, 6));
  }

  async function refreshRemoteData(farmId = selectedFarmId) {
    if (!farmId) return;
    const [records, evidence] = await Promise.all([fetchMyDailyRecords(farmId), fetchVisibleEvidence(farmId)]);
    if (selectedFarmRef.current !== farmId) return;
    setRemoteRecords(records);
    setRemoteEvidence(evidence);
  }

  async function signIn() {
    setStatus("Signing in...");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setStatus("Connected to Supabase. Loading your farm assignments...");
    } catch (error) {
      setStatus(error instanceof Error ? `Supabase login failed: ${error.message}` : "Supabase login failed.");
    }
  }

  async function loadFarms() {
    const assignedFarms = await fetchAssignedFarms();
    setFarms(assignedFarms);
    setSelectedFarmId((current) => assignedFarms.some((item) => item.farms.id === current) ? current : assignedFarms[0]?.farms.id || "");
    setStatus(assignedFarms.length ? "Supabase connected. Select a flock and enter today's work." : "Supabase connected, but no manager has assigned you to a farm yet.");
  }

  async function loadFlocks(farmId: string) {
    const farmFlocks = await fetchFarmFlocks(farmId);
    if (selectedFarmRef.current !== farmId) return;
    setFlocks(farmFlocks);
    setSelectedFlockId(farmFlocks[0]?.id || "");
  }

  async function saveDailyRecord() {
    const membership = farms.find((item) => item.farms.id === selectedFarmId);
    if (membership?.role === "viewer") {
      Alert.alert("Read-only access", "Your manager assigned you as a viewer. Ask for worker access to submit records.");
      return;
    }
    if (!selectedFarmId || !selectedFlockId) {
      Alert.alert("Missing selection", "Choose a farm and flock first.");
      return;
    }

    const recordId = id();
    const idempotencyKey = `mobile-${recordId}`;
    const mortalityCount = optionalNumber(mortality) ?? 0;
    const feedConsumed = optionalNumber(feed);
    const eggsCollected = optionalNumber(eggs);

    if (![mortalityCount, feedConsumed, eggsCollected].every((value) => value === null || Number.isFinite(value))) {
      Alert.alert("Check numbers", "Enter valid numeric values using a decimal point where needed.");
      return;
    }
    if (mortalityCount < 0 || (feedConsumed !== null && feedConsumed < 0) || (eggsCollected !== null && eggsCollected < 0)) {
      Alert.alert("Check numbers", "Daily record numbers cannot be negative.");
      return;
    }
    if (!Number.isInteger(mortalityCount) || (eggsCollected !== null && !Number.isInteger(eggsCollected))) {
      Alert.alert("Check numbers", "Mortality and eggs collected must be whole numbers.");
      return;
    }

    await savePendingDailyRecord({
      id: recordId,
      farm_id: selectedFarmId,
      flock_id: selectedFlockId,
      record_date: today(),
      mortality_count: mortalityCount,
      culling_count: 0,
      feed_consumed_kg: feedConsumed,
      water_consumed_liters: null,
      eggs_collected: eggsCollected,
      average_weight_grams: null,
      notes: notes || null,
      idempotency_key: idempotencyKey
    });

    setMortality("0");
    setFeed("");
    setEggs("");
    setNotes("");
    setStatus("Saved offline. Sync when network is available.");
    await refreshPendingCount();
    await refreshLocalRecords();
  }

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    try {
      const records = await getPendingDailyRecords();
      const evidenceItems = await getEvidenceQueue();
      if (!records.length && !evidenceItems.length) {
        setStatus("Everything is synced.");
        return;
      }

      setStatus("Syncing records and field evidence...");
      const farmIds = [...new Set(records.map((record) => record.farm_id))];
      let failedRecords = 0;

      for (const farmId of farmIds) {
        const farmRecords = records.filter((record) => record.farm_id === farmId);
        const response = await pushDailyRecords(farmRecords);

        failedRecords += await applyDailyRecordSyncResults(response);
      }

      const evidenceResults = evidenceItems.length ? await syncEvidenceQueue() : [];

      await refreshPendingCount();
      await refreshLocalRecords();
      await refreshEvidenceQueue();
      await refreshRemoteData();
      const failedEvidence = evidenceResults.filter((item) => item.syncStatus === "failed");
      const failures = failedRecords + failedEvidence.length;
      setStatus(failures ? `${failures} item${failures === 1 ? "" : "s"} could not sync and remain queued.` : "Sync complete.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sync failed. Try again when online.");
    } finally {
      setSyncing(false);
    }
  }

  async function captureEvidence() {
    if (!selectedFarmId) {
      Alert.alert("Select farm", "Choose a farm before taking field evidence.");
      return;
    }
    if (!canCaptureEvidence) {
      Alert.alert("Evidence unavailable", "Your farm assignment does not allow evidence capture.");
      return;
    }

    setCapturingEvidence(true);
    setStatus("Opening camera...");
    try {
      if (Platform.OS === "android") {
        await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION, PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]);
        setLocationStatus(await getLocationStatus().catch(() => null));
      }
      const item = await captureFieldEvidence({
        id: id(),
        farmId: selectedFarmId,
        flockId: selectedFlockId || null,
        farmName: selectedFarm?.farms.name ?? "Selected farm",
        flockName: selectedFlock?.name ?? "Selected flock",
        operatorLabel: session?.user.email ?? "Operator",
        notes: evidenceNotes.trim()
      });
      setEvidenceNotes("");
      await refreshEvidenceQueue();
      setStatus(item.latitude == null
        ? "Photo saved offline. GPS was unavailable; sync when online."
        : item.locationSource === "last_known"
          ? "Photo saved with an approximate last known location stamp."
          : "Photo stamped with date and fresh GPS, then saved offline.");
      if (item.latitude != null) setLocationStatus({ permissionGranted: true, providerEnabled: true, fixAvailable: true, accuracyMeters: item.accuracyMeters });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not capture field evidence.");
    } finally {
      setCapturingEvidence(false);
    }
  }

  async function exportPdf() {
    if (!selectedFarmId) {
      Alert.alert("Select farm", "Choose a farm before exporting.");
      return;
    }

    try {
      setStatus("Preparing PDF report...");
      const local = await getDailyRecordsForFarm(selectedFarmId);
      const remoteAsLocal: PendingDailyRecord[] = remoteRecords.map((record) => ({ ...record, sync_status: "synced" }));
      const byKey = new Map(remoteAsLocal.map((record) => [record.idempotency_key, record]));
      local.forEach((record) => byKey.set(record.idempotency_key, record));
      const records = [...byKey.values()].filter((record) => !selectedFlockId || record.flock_id === selectedFlockId).sort((a, b) => b.record_date.localeCompare(a.record_date));
      const farmName = farms.find((item) => item.farms.id === selectedFarmId)?.farms.name ?? "Selected Farm";
      const flockName = flocks.find((flock) => flock.id === selectedFlockId)?.name ?? "All visible flocks";
      const uri = await exportRecordsPdf({ farmName, flockName, records });
      setStatus(`PDF report ready: ${uri}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not export PDF.");
    }
  }

  function adjustField(field: "mortality" | "feed" | "eggs", amount: number) {
    const setter = field === "mortality" ? setMortality : field === "feed" ? setFeed : setEggs;
    const current = field === "mortality" ? mortality : field === "feed" ? feed : eggs;
    const numericCurrent = Number(current);
    const nextValue = Math.max(0, (Number.isFinite(numericCurrent) ? numericCurrent : 0) + amount);
    setter(String(nextValue));
  }

  function signOut() {
    if (!totalPending) {
      void supabase.auth.signOut();
      return;
    }
    Alert.alert("Leave field console?", `${totalPending} queued item${totalPending === 1 ? " is" : "s are"} safely stored on this device and will remain under your account.`, [
      { text: "Stay", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => { void supabase.auth.signOut(); } }
    ]);
  }

  const selectedFarm = farms.find((item) => item.farms.id === selectedFarmId);
  const selectedFlock = flocks.find((flock) => flock.id === selectedFlockId);
  const canLogRecords = Boolean(selectedFarm && selectedFarm.role !== "viewer");
  const canCaptureEvidence = Boolean(selectedFarm && selectedFarm.role !== "viewer" && selectedFarm.permissions.evidence);
  const totalPending = pendingCount + pendingEvidence.length;
  const selectedPendingEvidence = pendingEvidence.filter((item) => item.farmId === selectedFarmId);
  const visibleRecords = (() => {
    const byKey = new Map<string, PendingDailyRecord>(remoteRecords.map((record) => [record.idempotency_key, { ...record, sync_status: "synced" }]));
    localRecords.forEach((record) => byKey.set(record.idempotency_key, record));
    return [...byKey.values()].sort((a, b) => b.record_date.localeCompare(a.record_date)).slice(0, 8);
  })();

  if (!session) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor={colors.ink} />
        <View style={styles.loginScreen}>
          <View style={styles.loginBrand}><Logo /></View>
          <Text style={styles.loginKicker}>Field operations / secure access</Text>
          <Text style={styles.title}>The flock does not wait for Wi-Fi.</Text>
          <Text style={styles.body}>Capture today&apos;s work on-site. IQuila keeps it safely on this device until the network returns.</Text>
          <View style={styles.loginPanel}>
            <Text style={styles.inputLabel}>Operator email</Text>
            <TextInput accessibilityLabel="Operator email" style={styles.input} placeholder="name@farm.com" placeholderTextColor="#84938c" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="next" />
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput accessibilityLabel="Password" style={styles.input} placeholder="Your password" placeholderTextColor="#84938c" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" returnKeyType="go" onSubmitEditing={signIn} />
            <TouchableOpacity accessibilityRole="button" style={styles.primaryButton} onPress={signIn}><Text style={styles.primaryText}>Enter field console</Text></TouchableOpacity>
            <Text accessibilityLiveRegion="polite" style={styles.loginStatus}>{status}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.ink} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.consoleTop}>
          <View style={styles.brandPlate}><Logo compact /></View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${totalPending} items waiting to sync`} accessibilityState={{ busy: syncing, disabled: syncing }} style={[styles.syncControl, totalPending > 0 && styles.syncControlAlert]} onPress={syncNow} disabled={syncing}>
            <View style={[styles.syncDot, totalPending > 0 && styles.syncDotAlert]} />
            <Text style={styles.syncText}>{syncing ? "SYNCING" : totalPending ? `${totalPending} QUEUED` : "SYNCED"}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroCode}>IQUILA / FIELD RUN</Text>
          <Text style={styles.titleSmall}>{selectedFlock?.name || "Select a flock"}</Text>
          <Text style={styles.heroMeta}>{selectedFarm?.farms.name || "Loading assignment"}  /  {selectedFarm?.role || "operator"}  /  {today()}</Text>
          <ContextSelector label="Farm assignment">
            {farms.map((item) => <SelectorChip key={item.farms.id} label={item.farms.name} meta={`${item.role} / ${item.manager.full_name}`} selected={item.farms.id === selectedFarmId} onPress={() => setSelectedFarmId(item.farms.id)} />)}
          </ContextSelector>
          <ContextSelector label="Active flock">
            {flocks.map((flock) => <SelectorChip key={flock.id} label={flock.name} meta={`${flock.poultry_type} / ${flock.current_count} birds`} selected={flock.id === selectedFlockId} onPress={() => setSelectedFlockId(flock.id)} />)}
          </ContextSelector>
          <ConsoleTabs active={activeTab} onChange={setActiveTab} queueCount={totalPending} />
        </View>

        <View accessibilityLiveRegion="polite" style={styles.statusStrip}>
          <Text style={styles.statusMarker}>{status.toLowerCase().includes("error") || status.toLowerCase().includes("could not") ? "!" : "i"}</Text>
          <Text style={styles.statusText}>{status}</Text>
        </View>

        {activeTab === "run" ? (
          <View>
            <View style={styles.workspaceHeader}>
              <View><Text style={styles.sectionEyebrow}>01 / Daily run</Text><Text style={styles.workspaceTitle}>Log the essentials</Text></View>
              <Text style={styles.dateBlock}>{today().slice(5).replace("-", "/")}</Text>
            </View>
            {!canLogRecords ? <View style={styles.readOnlyCard}><Text style={styles.readOnlyTitle}>Read-only assignment</Text><Text style={styles.readOnlyText}>You can inspect this farm&apos;s logbook and proof, but a manager must grant logging access.</Text></View> : (
              <>
                <NumberLogger label="Mortality" unit="birds" step={1} value={mortality} onChange={setMortality} onMinus={() => adjustField("mortality", -1)} onPlus={() => adjustField("mortality", 1)} />
                <NumberLogger label="Feed consumed" unit="kilograms / step 5" step={5} value={feed} onChange={setFeed} onMinus={() => adjustField("feed", -5)} onPlus={() => adjustField("feed", 5)} decimal />
                <NumberLogger label="Eggs collected" unit="eggs" step={1} value={eggs} onChange={setEggs} onMinus={() => adjustField("eggs", -1)} onPlus={() => adjustField("eggs", 1)} />
                <Text style={styles.inputLabelDark}>Field notes / optional</Text>
                <TextInput accessibilityLabel="Field notes" style={[styles.input, styles.notes]} placeholder="Health, feed or flock observations" placeholderTextColor="#84938c" value={notes} onChangeText={setNotes} multiline />
                <TouchableOpacity accessibilityRole="button" style={styles.primaryButton} onPress={saveDailyRecord}><Text style={styles.primaryText}>Save run to device</Text><Text style={styles.primarySubtext}>Offline-safe / sync when ready</Text></TouchableOpacity>
              </>
            )}
          </View>
        ) : null}

        {activeTab === "proof" ? (
          <View>
            <View style={styles.workspaceHeader}><View><Text style={styles.sectionEyebrow}>02 / Evidence</Text><Text style={styles.workspaceTitle}>Proof from the field</Text></View><Text style={styles.countBlock}>{selectedPendingEvidence.length}</Text></View>
            <Text style={styles.helper}>Every photo is retained on this device until upload succeeds. Device time is always stamped; GPS is included when available.</Text>
            <View accessibilityRole="summary" style={[styles.locationCard, locationStatus?.fixAvailable && styles.locationCardAvailable]}>
              <View style={[styles.locationDot, locationStatus?.fixAvailable && styles.locationDotAvailable]} />
              <View style={styles.locationCopy}>
                <Text style={styles.locationTitle}>{locationStatus?.fixAvailable ? "GPS available" : locationStatus?.permissionGranted && locationStatus.providerEnabled ? "GPS enabled / waiting for fix" : locationStatus?.permissionGranted ? "Location services unavailable" : "GPS optional / permission needed"}</Text>
                <Text style={styles.locationMeta}>{locationStatus?.fixAvailable ? `Recent fix within ${Math.round(locationStatus.accuracyMeters ?? 0)} m` : "Photo capture remains available without a location stamp."}</Text>
              </View>
            </View>
            {canCaptureEvidence ? <><Text style={styles.inputLabelDark}>What does this photo show?</Text><TextInput accessibilityLabel="Evidence description" style={[styles.input, styles.evidenceNotes]} placeholder="Vaccination, condition, delivery..." placeholderTextColor="#84938c" value={evidenceNotes} onChangeText={setEvidenceNotes} multiline /><TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: capturingEvidence }} style={styles.captureButton} onPress={captureEvidence} disabled={capturingEvidence}><Text style={styles.captureCode}>CAM / GPS / TIME</Text><Text style={styles.captureText}>{capturingEvidence ? "Preparing camera..." : "Capture field proof"}</Text></TouchableOpacity></> : <View style={styles.readOnlyCard}><Text style={styles.readOnlyTitle}>Capture unavailable</Text><Text style={styles.readOnlyText}>Your current farm role does not include evidence capture.</Text></View>}
            <Text style={styles.listLabel}>On this device</Text>
            {selectedPendingEvidence.map((item) => <View style={styles.evidenceRow} key={item.id}><Image accessibilityRole="image" accessibilityLabel={`Evidence captured ${new Date(item.deviceCapturedAt).toLocaleString()}`} source={{ uri: item.localUri }} style={styles.evidenceImage} /><View style={styles.evidenceCopy}><Text style={styles.recordDate}>{new Date(item.deviceCapturedAt).toLocaleString()}</Text><Text style={styles.recordMeta}>{item.latitude == null ? "Location unavailable" : `${item.locationSource === "last_known" ? "Approximate / last known " : "GPS available "}${item.latitude.toFixed(5)}, ${item.longitude?.toFixed(5)}`}</Text>{item.locationCapturedAt ? <Text style={styles.recordMeta}>Location time {new Date(item.locationCapturedAt).toLocaleString()} / +/-{Math.round(item.accuracyMeters ?? 0)}m</Text> : null}{item.notes ? <Text style={styles.recordMeta}>{item.notes}</Text> : null}{item.error ? <Text style={styles.evidenceError}>{item.error}</Text> : null}</View><Text style={styles.pending}>{item.syncStatus}</Text></View>)}
            {!selectedPendingEvidence.length ? <Text style={styles.emptyText}>No photos waiting on this device.</Text> : null}
            <Text style={styles.listLabel}>Uploaded / recent</Text>
            {remoteEvidence.slice(0, 6).map((item) => <View style={styles.remoteEvidenceCard} key={item.id}><Image accessibilityRole="image" accessibilityLabel={item.notes || "Uploaded field evidence"} source={{ uri: item.signedUrl }} style={styles.remoteEvidenceImage} resizeMode="cover" /><View style={styles.remoteEvidenceMeta}><Text style={styles.recordDate}>{new Date(item.device_captured_at).toLocaleString()}</Text><Text style={styles.recordMeta}>{item.notes || "Uploaded field evidence"}</Text></View></View>)}
            {!remoteEvidence.length ? <Text style={styles.emptyText}>No uploaded proof is visible for this farm.</Text> : null}
          </View>
        ) : null}

        {activeTab === "queue" ? (
          <View>
            <View style={styles.workspaceHeader}><View><Text style={styles.sectionEyebrow}>03 / Transfer queue</Text><Text style={styles.workspaceTitle}>Safe on device</Text></View><Text style={styles.countBlock}>{totalPending}</Text></View>
            <Text style={styles.helper}>Queued work is stored under your account. Sync transfers all waiting records and photos across assigned farms.</Text>
            <View style={styles.queueGrid}><View style={styles.queueMetric}><Text style={styles.queueNumber}>{pendingCount}</Text><Text style={styles.queueLabel}>DAILY RECORDS</Text></View><View style={styles.queueMetric}><Text style={styles.queueNumber}>{pendingEvidence.length}</Text><Text style={styles.queueLabel}>FIELD PHOTOS</Text></View></View>
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: syncing, disabled: syncing }} style={styles.primaryButton} onPress={syncNow} disabled={syncing}><Text style={styles.primaryText}>{syncing ? "Transferring securely..." : totalPending ? `Sync ${totalPending} queued items` : "Check for updates"}</Text><Text style={styles.primarySubtext}>{totalPending ? "Items stay here if transfer fails" : "This device queue is clear"}</Text></TouchableOpacity>
            <Text style={styles.listLabel}>Current farm / waiting records</Text>
            {localRecords.filter((record) => record.sync_status !== "synced").map((record) => <View style={styles.recordRow} key={record.idempotency_key}><View style={styles.recordCopy}><Text style={styles.recordDate}>{record.record_date}</Text><Text style={styles.recordMeta}>Mortality {record.mortality_count} / Feed {record.feed_consumed_kg ?? 0}kg / Eggs {record.eggs_collected ?? 0}</Text></View><Text style={styles.pending}>{record.sync_status}</Text></View>)}
            {!localRecords.some((record) => record.sync_status !== "synced") ? <Text style={styles.emptyText}>No daily records waiting for this farm.</Text> : null}
          </View>
        ) : null}

        {activeTab === "logbook" ? (
          <View>
            <View style={styles.workspaceHeader}><View><Text style={styles.sectionEyebrow}>04 / Logbook</Text><Text style={styles.workspaceTitle}>{canLogRecords ? "My recent reports" : "Visible reports"}</Text></View><Text style={styles.countBlock}>{visibleRecords.length}</Text></View>
            <Text style={styles.helper}>Recent reports for {selectedFarm?.farms.name || "this farm"}. Export is scoped to the selected flock: {selectedFlock?.name || "all visible flocks"}.</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.exportButton} onPress={exportPdf}><Text style={styles.exportCode}>PDF / {selectedFlock?.name || "ALL FLOCKS"}</Text><Text style={styles.exportText}>Generate field report</Text></TouchableOpacity>
            {visibleRecords.map((record) => <View style={styles.recordRow} key={record.idempotency_key}><View style={styles.recordCopy}><Text style={styles.recordDate}>{record.record_date}</Text><Text style={styles.recordMeta}>Mortality {record.mortality_count} / Feed {record.feed_consumed_kg ?? 0}kg / Eggs {record.eggs_collected ?? 0}</Text>{record.notes ? <Text style={styles.recordNotes}>{record.notes}</Text> : null}</View><Text style={record.sync_status === "synced" ? styles.synced : styles.pending}>{record.sync_status}</Text></View>)}
            {!visibleRecords.length ? <Text style={styles.emptyText}>No reports yet. Save a daily run to begin.</Text> : null}
          </View>
        ) : null}

        <View style={styles.operatorFooter}>
          <View><Text style={styles.operatorLabel}>SIGNED IN OPERATOR</Text><Text style={styles.operatorName}>{session.user.email}</Text>{selectedFarm ? <Text style={styles.operatorMeta}>Assigned by {selectedFarm.manager.full_name} / {selectedFarm.role}</Text> : null}</View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Sign out" style={styles.signOutButton} onPress={signOut}><Text style={styles.signOutText}>EXIT</Text></TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.ink, flex: 1 },
  loginScreen: { flex: 1, justifyContent: "center", padding: 22 },
  loginBrand: { alignSelf: "flex-start", backgroundColor: colors.paper, borderRadius: 14, marginBottom: 26, padding: 12 },
  loginKicker: { color: colors.teal, fontSize: 10, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  title: { color: colors.white, fontSize: 39, fontWeight: "900", letterSpacing: -1.4, lineHeight: 42, marginBottom: 14, marginTop: 10 },
  body: { color: "#9fb6ac", fontSize: 16, lineHeight: 24, marginBottom: 22 },
  loginPanel: { backgroundColor: colors.forest, borderColor: "#28463b", borderRadius: 20, borderWidth: 1, padding: 18 },
  inputLabel: { color: "#a7bbb2", fontSize: 10, fontWeight: "900", letterSpacing: 1, marginBottom: 7, textTransform: "uppercase" },
  inputLabelDark: { color: colors.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginBottom: 7, marginHorizontal: 18, marginTop: 4, textTransform: "uppercase" },
  input: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 12, borderWidth: 1, color: colors.text, fontSize: 16, marginBottom: 13, minHeight: 52, padding: 14 },
  notes: { marginHorizontal: 18, minHeight: 96, textAlignVertical: "top" },
  evidenceNotes: { marginHorizontal: 18, minHeight: 72, textAlignVertical: "top" },
  loginStatus: { color: "#9fb6ac", fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: "center" },
  container: { backgroundColor: colors.paper, paddingBottom: 42 },
  consoleTop: { alignItems: "center", backgroundColor: colors.ink, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 14 },
  brandPlate: { backgroundColor: colors.paper, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  syncControl: { alignItems: "center", borderColor: "#315347", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 7, minHeight: 42, paddingHorizontal: 12 },
  syncControlAlert: { borderColor: "#795819" },
  syncDot: { backgroundColor: colors.teal, borderRadius: 99, height: 7, width: 7 },
  syncDotAlert: { backgroundColor: colors.amber },
  syncText: { color: "#c7d9d1", fontSize: 10, fontWeight: "900", letterSpacing: .8 },
  hero: { backgroundColor: colors.ink, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, paddingBottom: 18, paddingHorizontal: 18, paddingTop: 25 },
  heroCode: { color: colors.teal, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  titleSmall: { color: colors.white, fontSize: 34, fontWeight: "900", letterSpacing: -1, lineHeight: 40, marginTop: 6 },
  heroMeta: { color: "#7f998e", fontSize: 10, fontWeight: "800", marginTop: 5, textTransform: "uppercase" },
  statusStrip: { alignItems: "center", backgroundColor: "#e4ece7", borderRadius: 12, flexDirection: "row", marginHorizontal: 18, marginTop: 15, padding: 11 },
  statusMarker: { backgroundColor: colors.tealDark, borderRadius: 99, color: colors.white, fontSize: 11, fontWeight: "900", marginRight: 9, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3, textAlign: "center" },
  statusText: { color: colors.muted, flex: 1, fontSize: 12, lineHeight: 17 },
  workspaceHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, paddingBottom: 17, paddingTop: 25 },
  sectionEyebrow: { color: colors.tealDark, fontSize: 9, fontWeight: "900", letterSpacing: 1.2, marginBottom: 5, textTransform: "uppercase" },
  workspaceTitle: { color: colors.text, fontSize: 25, fontWeight: "900", letterSpacing: -.6 },
  dateBlock: { backgroundColor: colors.amber, borderRadius: 9, color: colors.ink, fontSize: 13, fontWeight: "900", overflow: "hidden", paddingHorizontal: 10, paddingVertical: 8 },
  countBlock: { backgroundColor: colors.forest, borderRadius: 9, color: colors.white, fontSize: 16, fontWeight: "900", minWidth: 38, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 8, textAlign: "center" },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 17, marginHorizontal: 18 },
  locationCard: { alignItems: "center", backgroundColor: colors.white, borderColor: colors.line, borderRadius: 13, borderWidth: 1, flexDirection: "row", marginBottom: 16, marginHorizontal: 18, padding: 13 },
  locationCardAvailable: { backgroundColor: "#e4f3ed", borderColor: "#b7ddd0" },
  locationDot: { backgroundColor: colors.muted, borderRadius: 99, height: 10, marginRight: 11, width: 10 },
  locationDotAvailable: { backgroundColor: colors.tealDark },
  locationCopy: { flex: 1 },
  locationTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  locationMeta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  primaryButton: { alignItems: "center", backgroundColor: colors.tealDark, borderRadius: 13, marginHorizontal: 18, padding: 16 },
  primaryText: { color: colors.white, fontSize: 15, fontWeight: "900" },
  primarySubtext: { color: "#b8ddd6", fontSize: 10, fontWeight: "800", letterSpacing: .5, marginTop: 4, textTransform: "uppercase" },
  readOnlyCard: { backgroundColor: "#f2e7d1", borderColor: "#e4d1ad", borderRadius: 14, borderWidth: 1, marginHorizontal: 18, padding: 16 },
  readOnlyTitle: { color: "#68490e", fontSize: 15, fontWeight: "900" },
  readOnlyText: { color: "#7d6841", fontSize: 13, lineHeight: 19, marginTop: 4 },
  captureButton: { backgroundColor: colors.amber, borderRadius: 13, marginHorizontal: 18, marginBottom: 15, padding: 17 },
  captureCode: { color: "#71500d", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  captureText: { color: colors.ink, fontSize: 18, fontWeight: "900", marginTop: 4 },
  exportButton: { backgroundColor: colors.forest, borderRadius: 13, marginBottom: 14, marginHorizontal: 18, padding: 16 },
  exportCode: { color: colors.teal, fontSize: 8, fontWeight: "900", letterSpacing: 1.1, textTransform: "uppercase" },
  exportText: { color: colors.white, fontSize: 16, fontWeight: "900", marginTop: 4 },
  listLabel: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1.2, marginHorizontal: 18, marginTop: 15, paddingBottom: 8, textTransform: "uppercase" },
  evidenceRow: { alignItems: "center", backgroundColor: colors.white, borderColor: colors.line, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, marginHorizontal: 18, padding: 9 },
  evidenceImage: { backgroundColor: colors.mist, borderRadius: 8, height: 62, width: 62 },
  evidenceCopy: { flex: 1 },
  evidenceError: { color: colors.danger, fontSize: 11, marginTop: 3 },
  remoteEvidenceCard: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 13, borderWidth: 1, marginBottom: 10, marginHorizontal: 18, overflow: "hidden" },
  remoteEvidenceImage: { aspectRatio: 16 / 10, backgroundColor: colors.mist, width: "100%" },
  remoteEvidenceMeta: { padding: 11 },
  queueGrid: { flexDirection: "row", gap: 10, marginBottom: 12, marginHorizontal: 18 },
  queueMetric: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 13, borderWidth: 1, flex: 1, padding: 16 },
  queueNumber: { color: colors.text, fontSize: 34, fontWeight: "900" },
  queueLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1, marginTop: 4 },
  recordRow: { alignItems: "center", backgroundColor: colors.white, borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", marginHorizontal: 18, paddingVertical: 13 },
  recordCopy: { flex: 1, paddingRight: 10 },
  recordDate: { color: colors.text, fontSize: 13, fontWeight: "900" },
  recordMeta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  recordNotes: { color: colors.text, fontSize: 12, fontStyle: "italic", marginTop: 5 },
  synced: { color: colors.tealDark, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  pending: { color: "#9a6509", fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  emptyText: { color: colors.muted, fontSize: 13, fontStyle: "italic", marginHorizontal: 18, paddingVertical: 14 },
  operatorFooter: { alignItems: "center", borderTopColor: colors.line, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginHorizontal: 18, marginTop: 34, paddingTop: 18 },
  operatorLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  operatorName: { color: colors.text, fontSize: 12, fontWeight: "900", marginTop: 4 },
  operatorMeta: { color: colors.muted, fontSize: 10, marginTop: 2, textTransform: "capitalize" },
  signOutButton: { borderColor: colors.line, borderRadius: 9, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 10 },
  signOutText: { color: colors.danger, fontSize: 9, fontWeight: "900", letterSpacing: 1 }
});
