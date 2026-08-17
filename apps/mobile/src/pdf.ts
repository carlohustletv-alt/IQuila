import { NativeModules } from "react-native";
import type { PendingDailyRecord } from "./offline";

interface FlockIqPdfNativeModule {
  exportRecordsPdf(payload: string): Promise<string>;
}

const FlockIqPdf = NativeModules.FlockIqPdf as FlockIqPdfNativeModule | undefined;

export async function exportRecordsPdf(params: {
  farmName: string;
  flockName: string;
  records: PendingDailyRecord[];
}) {
  if (!FlockIqPdf) {
    throw new Error("PDF export is not available in this Android build.");
  }

  return FlockIqPdf.exportRecordsPdf(JSON.stringify(params));
}
