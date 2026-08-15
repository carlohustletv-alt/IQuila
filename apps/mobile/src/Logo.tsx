import { StyleSheet, Text, View } from "react-native";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.lockup}>
      <View style={compact ? styles.compactFrame : undefined}>
        <View style={[styles.mark, compact && styles.markCompact]}>
          <View style={styles.iStem} />
          <View style={styles.iDot} />
          <View style={styles.qRing} />
          <View style={styles.qCutout} />
          <View style={styles.qTail} />
          <View style={styles.eye} />
          <View style={styles.beak} />
          <View style={styles.combLeft} />
          <View style={styles.combRight} />
        </View>
      </View>
      {!compact ? <View><Text style={styles.name}>IQuila</Text><Text style={styles.tagline}>Farm intelligence, clearly.</Text></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { alignItems: "center", flexDirection: "row", gap: 14 },
  mark: { backgroundColor: "#f7faf8", borderRadius: 18, height: 64, overflow: "hidden", position: "relative", width: 64 },
  compactFrame: { height: 44, overflow: "hidden", width: 44 },
  markCompact: { left: -10, position: "absolute", top: -10, transform: [{ scale: 0.69 }] },
  iStem: { backgroundColor: "#11766b", borderRadius: 5, bottom: 9, left: 7, position: "absolute", top: 21, width: 8 },
  iDot: { backgroundColor: "#f6a21a", borderRadius: 5, height: 9, left: 7, position: "absolute", top: 8, width: 9 },
  qRing: { borderColor: "#188778", borderRadius: 25, borderWidth: 8, height: 48, left: 15, position: "absolute", top: 12, width: 48 },
  qCutout: { backgroundColor: "#f7faf8", borderRadius: 8, bottom: 7, height: 17, position: "absolute", right: -1, transform: [{ rotate: "-36deg" }], width: 13 },
  qTail: { backgroundColor: "#f6a21a", borderRadius: 5, bottom: 3, height: 25, position: "absolute", right: 6, transform: [{ rotate: "-45deg" }], width: 8 },
  eye: { backgroundColor: "#202838", borderRadius: 3, height: 5, position: "absolute", right: 13, top: 25, width: 5 },
  beak: { borderBottomColor: "transparent", borderBottomWidth: 5, borderLeftColor: "#f6a21a", borderLeftWidth: 9, borderTopColor: "transparent", borderTopWidth: 5, position: "absolute", right: -1, top: 27 },
  combLeft: { backgroundColor: "#e94635", borderRadius: 7, height: 10, left: 27, position: "absolute", top: 3, transform: [{ rotate: "-25deg" }], width: 12 },
  combRight: { backgroundColor: "#e94635", borderRadius: 7, height: 11, left: 37, position: "absolute", top: 3, transform: [{ rotate: "18deg" }], width: 12 },
  name: { color: "#202838", fontSize: 27, fontWeight: "900", lineHeight: 29 },
  tagline: { color: "#11766b", fontSize: 12, fontWeight: "800", marginTop: 3 }
});
