import { app } from "electron";
import type { RuntimeDiagnostics, RuntimeIssue } from "../../shared/electron-api";
import { aiAgentService } from "./ai-agent-service.cjs";
import { sharkdService } from "./sharkd-service.cjs";

function sortIssues(issues: Array<RuntimeIssue | null>): RuntimeIssue[] {
  return issues
    .filter((issue): issue is RuntimeIssue => issue !== null)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export class AppService {
  async getRuntimeDiagnostics(): Promise<RuntimeDiagnostics> {
    const [sharkd, ai] = await Promise.all([
      sharkdService.getDiagnostics(),
      Promise.resolve(aiAgentService.getDiagnostics()),
    ]);

    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath("userData"),
      issues: sortIssues([sharkd.lastIssue, ai.lastIssue]),
      sharkd,
      ai,
    };
  }
}

export const appService = new AppService();
