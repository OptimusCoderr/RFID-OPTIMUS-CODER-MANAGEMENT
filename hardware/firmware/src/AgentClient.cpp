#include "AgentClient.h"
#include "Config.h"

AgentClient *AgentClient::instance = nullptr;

void AgentClient::begin() {
  instance = this;
  // Skip Engine.IO's long-polling handshake and go straight to a websocket
  // connection — socket.io server v4 (server/src/websocket/index.ts) allows
  // this by default since it doesn't restrict `transports`, and it saves a
  // polling round-trip on every (re)connect.
  ws.begin(AGENT_SERVER_HOST, AGENT_SERVER_PORT, "/socket.io/?EIO=4&transport=websocket");
  ws.onEvent(wsEventTrampoline);
  ws.setReconnectInterval(3000);
}

void AgentClient::loop() {
  ws.loop();

  if (nsConnected) {
    const unsigned long now = millis();
    if (now - lastAppHeartbeat >= Timing::APP_HEARTBEAT_MS) {
      lastAppHeartbeat = now;
      emitEvent("[\"heartbeat\"]");
    }
  }
}

void AgentClient::wsEventTrampoline(WStype_t type, uint8_t *payload, size_t length) {
  if (instance) instance->handleWsEvent(type, payload, length);
}

void AgentClient::handleWsEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[agent] websocket transport up, waiting for Engine.IO handshake");
      break;
    case WStype_DISCONNECTED:
      Serial.println("[agent] websocket disconnected");
      nsConnected = false;
      break;
    case WStype_TEXT: {
      // Built via concat(ptr, length), NOT the String(const char*) ctor —
      // `payload` is a raw length-delimited buffer from the WebSocket
      // frame, not guaranteed to be null-terminated. Constructing a String
      // from it as a C-string would scan past the buffer looking for a
      // terminator that might not be there.
      String packet;
      packet.concat(reinterpret_cast<const char *>(payload), length);
      handleEngineIoPacket(packet);
      break;
    }
    default:
      break; // binary/ping/pong/error frames at the WS layer — not used by this protocol
  }
}

void AgentClient::handleEngineIoPacket(const String &packet) {
  if (packet.length() == 0) return;
  const char engineType = packet[0];
  const String rest = packet.substring(1);

  switch (engineType) {
    case '0': // OPEN — handshake complete, server told us its sid/pingInterval/pingTimeout
      sendNamespaceConnect();
      break;
    case '2': // PING from server — Engine.IO v4 flipped ping origination to the server; we must PONG within pingTimeout
      ws.sendTXT("3");
      break;
    case '4': // MESSAGE — carries a Socket.IO packet
      handleSocketIoPacket(rest);
      break;
    case '1': // CLOSE
      nsConnected = false;
      break;
    default:
      break; // '3' pong (we don't ping the server ourselves), '5' upgrade, '6' noop
  }
}

void AgentClient::sendNamespaceConnect() {
  // Socket.IO CONNECT (packet type '0') to the /agent namespace, carrying
  // the auth payload — the wire form of the desktop agent's
  // `io(SERVER_URL + "/agent", { auth: { agentKey: AGENT_KEY } })`
  // (server/src/agent/agent.ts), checked server-side by
  // agentNsp.use(...)'s `socket.handshake.auth.agentKey` (server/src/websocket/index.ts).
  const String msg = "40/agent,{\"agentKey\":\"" + String(AGENT_KEY) + "\"}";
  ws.sendTXT(msg);
}

void AgentClient::handleSocketIoPacket(const String &packet) {
  if (packet.length() == 0) return;
  const char sioType = packet[0];
  String rest = packet.substring(1);

  // Every packet on a non-default namespace is prefixed "/agent," before
  // the actual payload. Tolerate its absence rather than mis-parsing if a
  // future server version ever omitted it.
  const String nsPrefixWithComma = "/agent,";
  if (rest.startsWith(nsPrefixWithComma)) rest = rest.substring(nsPrefixWithComma.length());
  else if (rest.startsWith("/agent")) rest = rest.substring(String("/agent").length());

  switch (sioType) {
    case '0': // CONNECT ack
      nsConnected = true;
      Serial.println("[agent] connected to /agent namespace");
      break;
    case '4': // CONNECT_ERROR — agentKey unknown/inactive encoder (see the agentNsp.use() middleware server-side)
      nsConnected = false;
      Serial.print("[agent] namespace connect rejected: ");
      Serial.println(rest);
      break;
    case '2': { // EVENT — rest is a JSON array: ["eventName", {...}]
      JsonDocument doc;
      const DeserializationError err = deserializeJson(doc, rest);
      if (err) {
        Serial.print("[agent] could not parse event payload: ");
        Serial.println(err.c_str());
        return;
      }
      JsonArray arr = doc.as<JsonArray>();
      if (arr.size() < 1) return;
      const String eventName = arr[0].as<String>();
      if (eventName == "command" && arr.size() >= 2 && commandCallback) {
        JsonObjectConst payload = arr[1];
        const String commandId = payload["commandId"] | "";
        const String command = payload["command"] | "";
        JsonObjectConst cmdArgs = payload["args"];
        commandCallback(commandId, command, cmdArgs);
      }
      break;
    }
    default:
      break; // '1' DISCONNECT, '3' ACK, '5'/'6' binary variants — unused by this app's protocol
  }
}

void AgentClient::emitEvent(const String &jsonArrayBody) {
  if (!nsConnected) return;
  ws.sendTXT("42/agent," + jsonArrayBody);
}

void AgentClient::emitCardDetected(const String &uidHex, const String &cardType) {
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  arr.add("card:detected");
  JsonObject data = arr.add<JsonObject>();
  data["uid"] = uidHex;
  if (cardType.length()) data["cardType"] = cardType;
  String out;
  serializeJson(doc, out);
  emitEvent(out);
}

void AgentClient::emitCommandResult(const String &commandId, const String &command, bool success,
                                     JsonVariantConst data, const String &error) {
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  arr.add("command:result");
  JsonObject result = arr.add<JsonObject>();
  result["commandId"] = commandId;
  result["command"] = command;
  result["success"] = success;
  if (!data.isNull()) result["data"] = data;
  if (!success && error.length()) result["error"] = error;
  String out;
  serializeJson(doc, out);
  emitEvent(out);
}
