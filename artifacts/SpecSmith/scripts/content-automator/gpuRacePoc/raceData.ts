// The race's builds, setting and Compare data: the one place they are chosen.

import {
  compareFiguresFor,
  compareGamesFor,
  loadCompareData,
  partName,
  type CompareBuildPair,
  type CompareSetting,
} from "../resultCards/compareFigures.ts";

export const RACE_BUILDS: CompareBuildPair = {
  a: { gpu: "rtx4080s", cpu: "r9-9950x3d" },
  b: { gpu: "rtx4080", cpu: "r9-9950x3d" },
};
export const RACE_SETTING: CompareSetting = { resolution: "1440p", preset: "high" };

export async function raceData() {
  const data = await loadCompareData();
  if (RACE_BUILDS.a.cpu !== RACE_BUILDS.b.cpu) throw new Error("The race credits the GPU; both builds must share a CPU.");
  const figures = compareFiguresFor(data, RACE_BUILDS, RACE_SETTING);
  const rows = compareGamesFor(data, RACE_BUILDS, RACE_SETTING);
  const names = { a: partName(data, "gpu", RACE_BUILDS.a.gpu), b: partName(data, "gpu", RACE_BUILDS.b.gpu) };
  return { figures, rows, names, sources: data.sources };
}

