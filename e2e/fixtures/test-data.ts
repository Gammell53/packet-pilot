import type {
  FrameData,
  FrameDetails,
  InstallHealthStatus,
  RuntimeDiagnostics,
  AppSettings,
  CaptureStatsResponse,
} from "../../shared/electron-api";

export const MOCK_FRAMES: FrameData[] = [
  {
    number: 1,
    time: "0.000000",
    source: "192.168.1.100",
    destination: "10.0.0.1",
    protocol: "TCP",
    length: "66",
    info: "49152 \u2192 443 [SYN] Seq=0 Win=64240 Len=0 MSS=1460",
    background: "e7e6ff",
    foreground: "000000",
  },
  {
    number: 2,
    time: "0.000345",
    source: "10.0.0.1",
    destination: "192.168.1.100",
    protocol: "TCP",
    length: "66",
    info: "443 \u2192 49152 [SYN, ACK] Seq=0 Ack=1 Win=65535 Len=0 MSS=1460",
    background: "e7e6ff",
    foreground: "000000",
  },
  {
    number: 3,
    time: "0.001234",
    source: "192.168.1.100",
    destination: "10.0.0.1",
    protocol: "TLSv1.3",
    length: "583",
    info: "Client Hello",
    background: "dce5f1",
    foreground: "000000",
  },
  {
    number: 4,
    time: "0.050000",
    source: "192.168.1.100",
    destination: "8.8.8.8",
    protocol: "DNS",
    length: "74",
    info: "Standard query 0x1234 A example.com",
    background: "ccf5ff",
    foreground: "000000",
  },
  {
    number: 5,
    time: "0.065000",
    source: "8.8.8.8",
    destination: "192.168.1.100",
    protocol: "DNS",
    length: "90",
    info: "Standard query response 0x1234 A example.com A 93.184.216.34",
    background: "ccf5ff",
    foreground: "000000",
  },
  {
    number: 6,
    time: "0.100000",
    source: "192.168.1.100",
    destination: "93.184.216.34",
    protocol: "HTTP",
    length: "345",
    info: "GET /api/data HTTP/1.1",
    background: "e5ffd5",
    foreground: "000000",
  },
  {
    number: 7,
    time: "0.200000",
    source: "93.184.216.34",
    destination: "192.168.1.100",
    protocol: "HTTP",
    length: "1240",
    info: "HTTP/1.1 200 OK (application/json)",
    background: "e5ffd5",
    foreground: "000000",
  },
  {
    number: 8,
    time: "0.300000",
    source: "192.168.1.100",
    destination: "ff:ff:ff:ff:ff:ff",
    protocol: "ARP",
    length: "42",
    info: "Who has 192.168.1.1? Tell 192.168.1.100",
    background: "faf0d7",
    foreground: "000000",
  },
  {
    number: 9,
    time: "0.400000",
    source: "192.168.1.100",
    destination: "8.8.8.8",
    protocol: "ICMP",
    length: "98",
    info: "Echo (ping) request id=0x0001, seq=1/256, ttl=64",
    background: "fce0ff",
    foreground: "000000",
  },
  {
    number: 10,
    time: "0.500000",
    source: "192.168.1.100",
    destination: "10.0.0.1",
    protocol: "TCP",
    length: "54",
    info: "49152 \u2192 443 [FIN, ACK] Seq=584 Ack=4097 Win=64240 Len=0",
    background: "e7e6ff",
    foreground: "000000",
  },
];

// Base64 of 64 bytes of sample hex data
const SAMPLE_BYTES = btoa(
  String.fromCharCode(
    0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x70,
    0x08, 0x00, 0x45, 0x00, 0x00, 0x34, 0x12, 0x34,
    0x40, 0x00, 0x40, 0x06, 0x00, 0x00, 0xc0, 0xa8,
    0x01, 0x64, 0x0a, 0x00, 0x00, 0x01, 0xc0, 0x00,
    0x01, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x50, 0x02, 0xfa, 0xf0, 0x00, 0x00,
    0x00, 0x00, 0x02, 0x04, 0x05, 0xb4, 0x01, 0x03,
    0x03, 0x06, 0x01, 0x01, 0x08, 0x0a, 0x00, 0x01,
  ),
);

export const MOCK_FRAME_DETAILS: Record<number, FrameDetails> = {
  1: {
    tree: [
      {
        l: "Frame 1: 66 bytes on wire (528 bits), 66 bytes captured (528 bits)",
        n: [
          { l: "Encapsulation type: Ethernet (1)" },
          { l: "Arrival Time: Jan  1, 2025 00:00:00.000000000 UTC" },
          { l: "Frame Number: 1" },
          { l: "Frame Length: 66 bytes (528 bits)" },
        ],
      },
      {
        l: "Ethernet II, Src: 00:1a:2b:3c:4d:5e, Dst: 08:00:27:00:00:01",
        n: [
          { l: "Destination: 08:00:27:00:00:01" },
          { l: "Source: 00:1a:2b:3c:4d:5e" },
          { l: "Type: IPv4 (0x0800)" },
        ],
      },
      {
        l: "Internet Protocol Version 4, Src: 192.168.1.100, Dst: 10.0.0.1",
        n: [
          { l: "Version: 4" },
          { l: "Header Length: 20 bytes (5)" },
          { l: "Total Length: 52" },
          { l: "Time to Live: 64" },
          { l: "Protocol: TCP (6)" },
          { l: "Source Address: 192.168.1.100" },
          { l: "Destination Address: 10.0.0.1" },
        ],
      },
      {
        l: "Transmission Control Protocol, Src Port: 49152, Dst Port: 443, Seq: 0, Len: 0",
        n: [
          { l: "Source Port: 49152" },
          { l: "Destination Port: 443" },
          { l: "Flags: 0x002 (SYN)", v: "SYN" },
          { l: "Window: 64240" },
        ],
      },
    ],
    bytes: SAMPLE_BYTES,
  },
  4: {
    tree: [
      {
        l: "Frame 4: 74 bytes on wire (592 bits), 74 bytes captured (592 bits)",
        n: [
          { l: "Frame Number: 4" },
          { l: "Frame Length: 74 bytes (592 bits)" },
        ],
      },
      {
        l: "Ethernet II, Src: 00:1a:2b:3c:4d:5e, Dst: 08:00:27:00:00:01",
        n: [
          { l: "Destination: 08:00:27:00:00:01" },
          { l: "Source: 00:1a:2b:3c:4d:5e" },
        ],
      },
      {
        l: "Internet Protocol Version 4, Src: 192.168.1.100, Dst: 8.8.8.8",
        n: [
          { l: "Source Address: 192.168.1.100" },
          { l: "Destination Address: 8.8.8.8" },
          { l: "Protocol: UDP (17)" },
        ],
      },
      {
        l: "User Datagram Protocol, Src Port: 53421, Dst Port: 53",
        n: [
          { l: "Source Port: 53421" },
          { l: "Destination Port: 53" },
        ],
      },
      {
        l: "Domain Name System (query)",
        n: [
          { l: "Transaction ID: 0x1234" },
          { l: "Queries", n: [{ l: "example.com: type A, class IN" }] },
        ],
      },
    ],
    bytes: SAMPLE_BYTES,
  },
  6: {
    tree: [
      {
        l: "Frame 6: 345 bytes on wire (2760 bits), 345 bytes captured (2760 bits)",
        n: [
          { l: "Frame Number: 6" },
          { l: "Frame Length: 345 bytes (2760 bits)" },
        ],
      },
      {
        l: "Ethernet II, Src: 00:1a:2b:3c:4d:5e, Dst: 08:00:27:00:00:02",
        n: [],
      },
      {
        l: "Internet Protocol Version 4, Src: 192.168.1.100, Dst: 93.184.216.34",
        n: [
          { l: "Source Address: 192.168.1.100" },
          { l: "Destination Address: 93.184.216.34" },
        ],
      },
      {
        l: "Hypertext Transfer Protocol",
        n: [
          { l: "GET /api/data HTTP/1.1\\r\\n" },
          { l: "Host: example.com\\r\\n" },
          { l: "User-Agent: PacketPilot/1.0\\r\\n" },
        ],
      },
    ],
    bytes: SAMPLE_BYTES,
  },
};

export const MOCK_INSTALL_HEALTH: InstallHealthStatus = {
  ok: true,
  issues: [],
  checked_paths: ["/usr/bin/sharkd"],
  recommended_action: "",
};

export const MOCK_RUNTIME_DIAGNOSTICS: RuntimeDiagnostics = {
  appVersion: "1.0.0-test",
  platform: "linux",
  arch: "x64",
  isPackaged: false,
  appPath: "/home/test/packet-pilot",
  resourcesPath: "/home/test/packet-pilot/resources",
  userDataPath: "/home/test/.config/packet-pilot",
  issues: [],
  sharkd: {
    isRunning: true,
    activeFilter: "",
    resolvedPath: "/usr/bin/sharkd",
    bundledCandidates: [],
    systemCandidates: ["/usr/bin/sharkd"],
    lastKnownStatus: { frames: 10, duration: 5.432, filename: "capture.pcap" },
    installHealth: {
      ok: true,
      issues: [],
      checked_paths: ["/usr/bin/sharkd"],
      recommended_action: "",
    },
    lastIssue: null,
  },
  ai: {
    isRunning: false,
    configuredModel: "anthropic/claude-sonnet-4",
    hasApiKey: false,
    activeRequestCount: 0,
    lastIssue: null,
  },
};

export const MOCK_SETTINGS: AppSettings = {
  apiKey: null,
  model: "anthropic/claude-sonnet-4",
};

export const MOCK_SETTINGS_WITH_KEY: AppSettings = {
  apiKey: "sk-or-v1-test-key-for-playwright",
  model: "anthropic/claude-sonnet-4",
};

export const MOCK_CAPTURE_STATS: CaptureStatsResponse = {
  summary: {
    total_frames: 10,
    duration: 0.5,
    protocol_count: 6,
    tcp_conversation_count: 1,
    udp_conversation_count: 1,
    endpoint_count: 5,
  },
  protocol_hierarchy: [
    {
      protocol: "eth",
      frames: 10,
      bytes: 2258,
      children: [
        {
          protocol: "ip",
          frames: 9,
          bytes: 2216,
          children: [
            { protocol: "tcp", frames: 4, bytes: 769, children: [] },
            { protocol: "udp", frames: 2, bytes: 164, children: [] },
            { protocol: "icmp", frames: 1, bytes: 98, children: [] },
          ],
        },
        { protocol: "arp", frames: 1, bytes: 42, children: [] },
      ],
    },
  ],
  tcp_conversations: [
    {
      src_addr: "192.168.1.100",
      dst_addr: "10.0.0.1",
      src_port: "49152",
      dst_port: "443",
      rx_frames: 1,
      rx_bytes: 66,
      tx_frames: 3,
      tx_bytes: 703,
      filter: null,
    },
  ],
  udp_conversations: [
    {
      src_addr: "192.168.1.100",
      dst_addr: "8.8.8.8",
      src_port: "53421",
      dst_port: "53",
      rx_frames: 1,
      rx_bytes: 90,
      tx_frames: 1,
      tx_bytes: 74,
      filter: null,
    },
  ],
  endpoints: [
    { host: "192.168.1.100", port: null, rx_frames: 4, rx_bytes: 462, tx_frames: 6, tx_bytes: 1796 },
    { host: "10.0.0.1", port: null, rx_frames: 3, rx_bytes: 703, tx_frames: 1, tx_bytes: 66 },
    { host: "8.8.8.8", port: null, rx_frames: 1, rx_bytes: 74, tx_frames: 1, tx_bytes: 90 },
    { host: "93.184.216.34", port: null, rx_frames: 1, rx_bytes: 345, tx_frames: 1, tx_bytes: 1240 },
    { host: "ff:ff:ff:ff:ff:ff", port: null, rx_frames: 1, rx_bytes: 42, tx_frames: 0, tx_bytes: 0 },
  ],
};
