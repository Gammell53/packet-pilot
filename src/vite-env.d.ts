/// <reference types="vite/client" />

import type { PacketPilotApi } from "../shared/electron-api";

declare global {
  interface Window {
    packetPilot: PacketPilotApi;
  }
}
