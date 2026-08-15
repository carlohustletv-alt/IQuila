import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { colors, radius } from "../theme";

export type ConsoleTab = "run" | "proof" | "queue" | "logbook";

const tabs: { key: ConsoleTab; label: string; code: string }[] = [
  { key: "run", label: "Run", code: "01" },
  { key: "proof", label: "Proof", code: "02" },
  { key: "queue", label: "Queue", code: "03" },
  { key: "logbook", label: "Logbook", code: "04" }
];

export function ConsoleTabs({ active, onChange, queueCount }: { active: ConsoleTab; onChange: (tab: ConsoleTab) => void; queueCount: number }) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {tabs.map((tab) => {
        const selected = active === tab.key;
        return (
          <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={`${tab.label} workspace`} key={tab.key} onPress={() => onChange(tab.key)} style={[styles.tab, selected && styles.tabActive]}>
            <Text style={[styles.tabCode, selected && styles.tabCodeActive]}>{tab.code}</Text>
            <Text style={[styles.tabText, selected && styles.tabTextActive]}>{tab.label}{tab.key === "queue" && queueCount ? ` ${queueCount}` : ""}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function ContextSelector({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.contextBlock}><Text style={styles.contextLabel}>{label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{children}</ScrollView></View>;
}

export function SelectorChip({ label, meta, selected, onPress }: { label: string; meta?: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={meta ? `${label}, ${meta}` : label} onPress={onPress} style={[styles.chip, selected && styles.chipActive]}>
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text>
      {meta ? <Text style={[styles.chipMeta, selected && styles.chipMetaActive]}>{meta}</Text> : null}
    </TouchableOpacity>
  );
}

export function NumberLogger({ label, unit, value, onChange, onMinus, onPlus, step, decimal = false }: { label: string; unit: string; value: string; onChange: (value: string) => void; onMinus: () => void; onPlus: () => void; step: number; decimal?: boolean }) {
  return (
    <View style={styles.loggerBlock}>
      <View style={styles.loggerHeading}><Text style={styles.loggerLabel}>{label}</Text><Text style={styles.loggerUnit}>{unit}</Text></View>
      <View style={styles.loggerRow}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Decrease ${label} by ${step}`} style={styles.stepButton} onPress={onMinus}><Text style={styles.stepButtonText}>-</Text></TouchableOpacity>
        <TextInput accessibilityLabel={label} style={styles.loggerInput} value={value} onChangeText={onChange} keyboardType={decimal ? "decimal-pad" : "number-pad"} selectTextOnFocus />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Increase ${label} by ${step}`} style={styles.stepButton} onPress={onPlus}><Text style={styles.stepButtonText}>+</Text></TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { backgroundColor: colors.forest, borderColor: "#29483d", borderRadius: radius.medium, borderWidth: 1, flexDirection: "row", gap: 3, marginTop: 16, padding: 4 },
  tab: { alignItems: "center", borderRadius: 10, flex: 1, minHeight: 55, justifyContent: "center", paddingHorizontal: 3, paddingVertical: 7 },
  tabActive: { backgroundColor: colors.paper },
  tabCode: { color: "#638477", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  tabCodeActive: { color: colors.amber },
  tabText: { color: "#a5b9b0", fontSize: 11, fontWeight: "900", marginTop: 3 },
  tabTextActive: { color: colors.text },
  contextBlock: { marginTop: 12 },
  contextLabel: { color: "#769087", fontSize: 9, fontWeight: "900", letterSpacing: 1.4, marginBottom: 8, textTransform: "uppercase" },
  chip: { backgroundColor: "#18362c", borderColor: "#315247", borderRadius: 10, borderWidth: 1, marginRight: 8, minWidth: 110, paddingHorizontal: 13, paddingVertical: 10 },
  chipActive: { backgroundColor: colors.amber, borderColor: colors.amber },
  chipText: { color: "#d8e6df", fontSize: 13, fontWeight: "900" },
  chipTextActive: { color: colors.ink },
  chipMeta: { color: "#789388", fontSize: 9, fontWeight: "700", marginTop: 3, textTransform: "capitalize" },
  chipMetaActive: { color: "#61420c" },
  loggerBlock: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: radius.medium, borderWidth: 1, marginBottom: 10, marginHorizontal: 18, padding: 13 },
  loggerHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 9 },
  loggerLabel: { color: colors.text, fontSize: 15, fontWeight: "900" },
  loggerUnit: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: .8, textTransform: "uppercase" },
  loggerRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  stepButton: { alignItems: "center", backgroundColor: colors.mist, borderRadius: 10, height: 48, justifyContent: "center", width: 48 },
  stepButtonText: { color: colors.tealDark, fontSize: 25, fontWeight: "700" },
  loggerInput: { backgroundColor: colors.paper, borderColor: colors.line, borderRadius: 10, borderWidth: 1, color: colors.text, flex: 1, fontSize: 22, fontWeight: "900", minHeight: 48, padding: 8, textAlign: "center" }
});
