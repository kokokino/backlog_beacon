// Minimal Ubisoft Demux client for fetching owned games via the binary protobuf protocol.
// Vendored from the protocol used by Ubisoft Connect desktop client (dmx.upc.ubisoft.com:443).
// Only implements the subset needed: authenticate → open ownership_service → InitializeReq.

import tls from 'tls';
import protobuf from 'protobufjs';
import { Meteor } from 'meteor/meteor';

const DEMUX_HOST = 'dmx.upc.ubisoft.com';
const DEMUX_PORT = 443;
const API_VERSION = 13045;
const DEFAULT_TIMEOUT_MS = 15000;

// Proto definitions inlined as strings — Meteor's bundler doesn't copy .proto files
// to the build directory, so we can't use loadSync() with file paths.
// Vendored from YoobieRE/ubisoft-demux-node.

const DEMUX_PROTO = `
syntax = "proto2";
package mg.protocol.demux;

message Token {
  optional string ubi_ticket = 3;
}

message AuthenticateReq {
  required Token token = 1;
  optional bool send_keep_alive = 4 [default = true];
  optional string client_id = 2;
}

message AuthenticateRsp {
  required bool success = 1;
  optional bool expired = 2;
  optional bool banned = 3;
}

message OpenConnectionReq {
  required string service_name = 2;
}

message OpenConnectionRsp {
  required uint32 connection_id = 1;
  required bool success = 2;
}

message KeepAlivePush {}

message DataMessage {
  required uint32 connection_id = 1;
  required bytes data = 2;
}

message ClientVersionPush {
  required uint32 version = 1;
}

message ClientOutdatedPush {}

message ConnectionClosedPush {
  required uint32 connection_id = 1;
}

message Req {
  required uint32 request_id = 1;
  optional AuthenticateReq authenticate_req = 2;
  optional OpenConnectionReq open_connection_req = 3;
}

message Rsp {
  required uint32 request_id = 1;
  optional AuthenticateRsp authenticate_rsp = 2;
  optional OpenConnectionRsp open_connection_rsp = 3;
}

message Push {
  optional DataMessage data = 1;
  optional ConnectionClosedPush connection_closed = 2;
  optional KeepAlivePush keep_alive = 3;
  optional ClientVersionPush client_version = 4;
  optional ClientOutdatedPush client_outdated = 5;
}

message Upstream {
  optional Req request = 1;
  optional Push push = 2;
}

message Downstream {
  optional Rsp response = 1;
  optional Push push = 2;
}
`;

const OWNERSHIP_PROTO = `
syntax = "proto2";
package mg.protocol.ownership;

message OwnedGame {
  required uint32 product_id = 1;
  optional uint32 product_type = 8;
  optional uint32 state = 13;
  optional string configuration = 17;
  optional string ubiservices_space_id = 30;
  optional uint32 download_id = 5;
  optional uint32 platform = 7;
  optional bool owned = 20;
  optional uint32 uplay_id = 19;
}

message OwnedGames {
  repeated OwnedGame owned_games = 1;
}

message InitializeReq {
  optional bool deprecated_test_config = 1;
  optional bool get_associations = 2;
  optional uint32 proto_version = 3;
  optional bool use_staging = 5 [default = false];
}

message InitializeRsp {
  required bool success = 1;
  optional OwnedGames owned_games = 2;
}

message Req {
  required uint32 request_id = 1;
  optional InitializeReq initialize_req = 2;
}

message Rsp {
  required uint32 request_id = 1;
  optional InitializeRsp initialize_rsp = 2;
}

message Upstream {
  optional Req request = 1;
}

message Downstream {
  optional Rsp response = 1;
}
`;

// Cached proto type lookups
let protos = null;

function loadProtos() {
  if (protos) {
    return protos;
  }

  const demuxRoot = protobuf.parse(DEMUX_PROTO).root;
  const ownershipRoot = protobuf.parse(OWNERSHIP_PROTO).root;

  protos = {
    DemuxUpstream: demuxRoot.lookupType('mg.protocol.demux.Upstream'),
    DemuxDownstream: demuxRoot.lookupType('mg.protocol.demux.Downstream'),
    OwnershipUpstream: ownershipRoot.lookupType('mg.protocol.ownership.Upstream'),
    OwnershipDownstream: ownershipRoot.lookupType('mg.protocol.ownership.Downstream')
  };

  return protos;
}

// Add 4-byte big-endian length prefix to a buffer
function addLengthPrefix(data) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length, 0);
  return Buffer.concat([header, data]);
}

// Read one length-prefixed message from the TLS socket
function readMessage(socket, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let expectedLength = null;
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Demux read timeout'));
      }
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    }

    function tryResolve() {
      if (settled) {
        return;
      }

      // Read length header
      if (expectedLength === null && buffer.length >= 4) {
        expectedLength = buffer.readUInt32BE(0);
        buffer = buffer.subarray(4);
      }

      // Read full message
      if (expectedLength !== null && buffer.length >= expectedLength) {
        settled = true;
        const message = buffer.subarray(0, expectedLength);
        cleanup();
        resolve(message);
      }
    }

    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      tryResolve();
    }

    function onError(error) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    }

    function onClose() {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Socket closed before message received'));
      }
    }

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);

    // Check if there's already buffered data on the socket
    tryResolve();
  });
}

// Encode and send an outer Upstream message, then read and decode the Downstream response
async function sendAndReceive(socket, types, upstreamPayload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const encoded = types.DemuxUpstream.encode(
    types.DemuxUpstream.create(upstreamPayload)
  ).finish();

  socket.write(addLengthPrefix(Buffer.from(encoded)));

  const responseBytes = await readMessage(socket, timeoutMs);
  return types.DemuxDownstream.decode(responseBytes);
}

// Connect to Demux and fetch owned games using the binary protocol
export async function fetchOwnedGamesViaDemux(ticket) {
  const types = loadProtos();
  let socket = null;
  let requestId = 1;

  try {
    // 1. TLS connect
    socket = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('TLS connect timeout')), DEFAULT_TIMEOUT_MS);
      const sock = tls.connect({ host: DEMUX_HOST, port: DEMUX_PORT, maxVersion: 'TLSv1.2' }, () => {
        clearTimeout(timeout);
        resolve(sock);
      });
      sock.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    // 2. Send clientVersion push (required first message)
    const versionPush = types.DemuxUpstream.encode(
      types.DemuxUpstream.create({
        push: { clientVersion: { version: API_VERSION } }
      })
    ).finish();

    socket.write(addLengthPrefix(Buffer.from(versionPush)));

    // 3. Authenticate (clientVersion push is fire-and-forget, no response expected)
    const authResponse = await sendAndReceive(socket, types, {
      request: {
        requestId: requestId++,
        authenticateReq: {
          clientId: 'uplay_pc',
          sendKeepAlive: false,
          token: { ubiTicket: ticket }
        }
      }
    });
    if (!authResponse.response || !authResponse.response.authenticateRsp || !authResponse.response.authenticateRsp.success) {
      throw new Meteor.Error('auth-invalid', 'Ubisoft session expired. Please try again.');
    }

    // 5. Open connection to ownership_service
    const openResponse = await sendAndReceive(socket, types, {
      request: {
        requestId: requestId++,
        openConnectionReq: { serviceName: 'ownership_service' }
      }
    });
    if (!openResponse.response || !openResponse.response.openConnectionRsp || !openResponse.response.openConnectionRsp.success) {
      throw new Meteor.Error('api-error', 'Failed to connect to Ubisoft ownership service.');
    }

    const connectionId = openResponse.response.openConnectionRsp.connectionId;

    // 6. Send ownership InitializeReq via DataMessage push
    const ownershipReq = types.OwnershipUpstream.encode(
      types.OwnershipUpstream.create({
        request: {
          requestId: requestId++,
          initializeReq: {
            getAssociations: true,
            protoVersion: 7,
            useStaging: false
          }
        }
      })
    ).finish();

    // Inner message is length-prefixed within the DataMessage
    const innerData = addLengthPrefix(Buffer.from(ownershipReq));

    const dataMessage = types.DemuxUpstream.encode(
      types.DemuxUpstream.create({
        push: {
          data: {
            connectionId,
            data: innerData
          }
        }
      })
    ).finish();

    socket.write(addLengthPrefix(Buffer.from(dataMessage)));

    // 7. Read ownership InitializeRsp from DataMessage push
    // The server may send intermediate pushes (keep-alive, etc.), so loop
    // until we get a DataMessage push with our ownership response.
    let ownershipDownstream = null;
    for (let readAttempt = 0; readAttempt < 5; readAttempt++) {
      const ownershipBytes = await readMessage(socket);
      const downstream = types.DemuxDownstream.decode(ownershipBytes);
      if (downstream.push && downstream.push.data) {
        ownershipDownstream = downstream;
        break;
      }
      // Otherwise it's a keep-alive or other push — skip and read again
    }

    if (!ownershipDownstream) {
      throw new Meteor.Error('api-error', 'Failed to fetch Ubisoft library: no DataMessage received.');
    }

    // Inner data is also length-prefixed: strip 4-byte header
    let innerResponseData = Buffer.from(ownershipDownstream.push.data.data);
    if (innerResponseData.length > 4) {
      const innerLength = innerResponseData.readUInt32BE(0);
      innerResponseData = innerResponseData.subarray(4, 4 + innerLength);
    }

    const ownershipResponse = types.OwnershipDownstream.decode(innerResponseData);
    if (!ownershipResponse.response || !ownershipResponse.response.initializeRsp || !ownershipResponse.response.initializeRsp.success) {
      throw new Meteor.Error('api-error', 'Failed to fetch Ubisoft library. Please try again.');
    }

    const ownedGames = ownershipResponse.response.initializeRsp.ownedGames;
    const gameList = ownedGames ? (ownedGames.ownedGames || []) : [];
    return gameList;
  } catch (error) {
    if (error instanceof Meteor.Error) {
      throw error;
    }
    if (error.message && error.message.includes('timeout')) {
      throw new Meteor.Error('network-error', 'Could not connect to Ubisoft. Please try again later.');
    }
    throw new Meteor.Error('api-error', 'Failed to fetch Ubisoft library. Please try again.');
  } finally {
    if (socket) {
      socket.destroy();
    }
  }
}
