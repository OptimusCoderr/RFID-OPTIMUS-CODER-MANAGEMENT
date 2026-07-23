#pragma once
#include <Arduino.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <functional>

// A from-scratch Engine.IO v4 / Socket.IO v4 client built on the low-level
// WebSocketsClient primitive (raw connect/onEvent/sendTXT), not the
// higher-level SocketIOclient wrapper the same library also ships. That's
// deliberate: this needs to CONNECT clients to a specific namespace
// ("/agent") carrying a custom auth payload — `io(url + "/agent", { auth:
// { agentKey } })` on the JS side — and hand-framing the three packet types
// this protocol actually needs (namespace CONNECT-with-auth, EVENT, and the
// Engine.IO ping/pong keepalive) is more certain to be correct than
// depending on how much of that a wrapper class supports. See
// ../../README.md for the full protocol notes and the "not tested against
// a live server" disclosure.
//
// Wire protocol this implements (matches server/src/websocket/index.ts's
// `/agent` namespace and server/src/agent/agent.ts's desktop equivalent):
//   → connect:        GET /socket.io/?EIO=4&transport=websocket (ws upgrade)
//   ← engine.io OPEN:  0{"sid":"...","pingInterval":25000,...}
//   → namespace CONNECT: 40/agent,{"agentKey":"<key>"}
//   ← namespace CONNECT ack: 40/agent,{"sid":"..."}
//   ← engine.io PING (server-initiated): 2      → we must reply: 3
//   → app heartbeat (every 30s, business-logic, NOT the engine.io ping):
//       42/agent,["heartbeat"]
//   → card:detected:  42/agent,["card:detected",{"uid":"...","cardType":"..."}]
//   ← command:        42/agent,["command",{"commandId":"...","command":"...","args":{...}}]
//   → command:result: 42/agent,["command:result",{"commandId":"...","command":"...","success":true,"data":{...}}]
class AgentClient {
public:
  using CommandCallback = std::function<void(const String &commandId, const String &command, JsonObjectConst args)>;

  void begin();
  void loop();
  bool isConnected() const { return nsConnected; }

  void onCommand(CommandCallback cb) { commandCallback = cb; }
  void emitCardDetected(const String &uidHex, const String &cardType = "");
  void emitCommandResult(const String &commandId, const String &command, bool success, JsonVariantConst data,
                          const String &error = "");

private:
  WebSocketsClient ws;
  bool nsConnected = false; // Socket.IO /agent namespace CONNECT has been acked
  unsigned long lastAppHeartbeat = 0;
  CommandCallback commandCallback;

  void handleWsEvent(WStype_t type, uint8_t *payload, size_t length);
  void handleEngineIoPacket(const String &packet);
  void handleSocketIoPacket(const String &packet);
  void sendNamespaceConnect();
  void emitEvent(const String &jsonArrayBody);

  static AgentClient *instance;
  static void wsEventTrampoline(WStype_t type, uint8_t *payload, size_t length);
};
