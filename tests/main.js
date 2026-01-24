import assert from "assert";
import { Meteor } from "meteor/meteor";
import { Random } from "meteor/random";

describe("backlog_beacon", function () {
  it("package.json has correct name", async function () {
    const { name } = await import("../package.json");
    assert.strictEqual(name, "backlog_beacon");
  });

  if (Meteor.isClient) {
    it("client is not server", function () {
      assert.strictEqual(Meteor.isServer, false);
    });
  }

  if (Meteor.isServer) {
    // Import server methods so they're registered during tests
    require('../server/methods.js');

    it("server is not client", function () {
      assert.strictEqual(Meteor.isClient, false);
    });

    describe("SSO Token Validation", function () {
      it("rejects empty token", async function () {
        const { validateSsoToken } = await import("../imports/hub/ssoHandler.js");
        const result = await validateSsoToken(null);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, "no_token");
      });

      it("rejects undefined token", async function () {
        const { validateSsoToken } = await import("../imports/hub/ssoHandler.js");
        const result = await validateSsoToken(undefined);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, "no_token");
      });

      it("rejects empty string token", async function () {
        const { validateSsoToken } = await import("../imports/hub/ssoHandler.js");
        const result = await validateSsoToken("");
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, "no_token");
      });

      it("rejects malformed token", async function () {
        const { validateSsoToken } = await import("../imports/hub/ssoHandler.js");
        const result = await validateSsoToken("not-a-valid-jwt");
        assert.strictEqual(result.valid, false);
        assert.ok(result.error);
      });

      it("rejects token with invalid signature", async function () {
        const { validateSsoToken } = await import("../imports/hub/ssoHandler.js");
        const fakeToken = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0MTIzIiwidXNlcm5hbWUiOiJ0ZXN0dXNlciIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImFwcElkIjoiYmFja2xvZ19iZWFjb24iLCJpYXQiOjE3MDQwNjcyMDAsImV4cCI6MTcwNDA2NzUwMCwibm9uY2UiOiJ0ZXN0LW5vbmNlIn0.invalid-signature";
        const result = await validateSsoToken(fakeToken);
        assert.strictEqual(result.valid, false);
      });
    });

    describe("Subscription Checking", function () {
      it("grants access when no products required", async function () {
        const { checkSubscription } = await import("../imports/hub/subscriptions.js");
        const result = await checkSubscription("fake-user-id", []);
        assert.strictEqual(result, true);
      });

      it("grants access when requiredProductSlugs is null", async function () {
        const { checkSubscription } = await import("../imports/hub/subscriptions.js");
        const result = await checkSubscription("fake-user-id", null);
        assert.strictEqual(result, true);
      });

      it("grants access when requiredProductSlugs is undefined", async function () {
        const { checkSubscription } = await import("../imports/hub/subscriptions.js");
        const result = await checkSubscription("fake-user-id", undefined);
        assert.strictEqual(result, true);
      });

      it("denies access for non-existent user with required products", async function () {
        const { checkSubscription } = await import("../imports/hub/subscriptions.js");
        const result = await checkSubscription("non-existent-user-id", ["base_monthly"]);
        assert.strictEqual(result, false);
      });
    });

    describe("Collection Status Constants", function () {
      it("exports valid status constants", async function () {
        const { COLLECTION_STATUSES, STATUS_LABELS } = await import("../imports/lib/collections/collectionItems.js");
        
        assert.strictEqual(COLLECTION_STATUSES.BACKLOG, "backlog");
        assert.strictEqual(COLLECTION_STATUSES.PLAYING, "playing");
        assert.strictEqual(COLLECTION_STATUSES.COMPLETED, "completed");
        assert.strictEqual(COLLECTION_STATUSES.ABANDONED, "abandoned");
        
        assert.strictEqual(STATUS_LABELS.backlog, "Backlog");
        assert.strictEqual(STATUS_LABELS.playing, "Playing");
        assert.strictEqual(STATUS_LABELS.completed, "Completed");
        assert.strictEqual(STATUS_LABELS.abandoned, "Abandoned");
      });
    });

    describe("Collection Methods", function () {
      it("collection.addItem rejects unauthenticated users", async function () {
        try {
          await Meteor.callAsync("collection.addItem", "game123", "PC", "backlog");
          assert.fail("Should have thrown an error");
        } catch (error) {
          assert.strictEqual(error.error, "not-authorized");
        }
      });

      it("collection.updateItem rejects unauthenticated users", async function () {
        try {
          await Meteor.callAsync("collection.updateItem", "item123", { status: "playing" });
          assert.fail("Should have thrown an error");
        } catch (error) {
          assert.strictEqual(error.error, "not-authorized");
        }
      });

      it("collection.removeItem rejects unauthenticated users", async function () {
        try {
          await Meteor.callAsync("collection.removeItem", "item123");
          assert.fail("Should have thrown an error");
        } catch (error) {
          assert.strictEqual(error.error, "not-authorized");
        }
      });

      it("collection.getStats rejects unauthenticated users", async function () {
        try {
          await Meteor.callAsync("collection.getStats");
          assert.fail("Should have thrown an error");
        } catch (error) {
          assert.strictEqual(error.error, "not-authorized");
        }
      });

      it("games.search rejects unauthenticated users", async function () {
        try {
          await Meteor.callAsync("games.search", "zelda");
          assert.fail("Should have thrown an error");
        } catch (error) {
          assert.strictEqual(error.error, "not-authorized");
        }
      });

      it("user.hasAccess returns false when no user logged in", async function () {
        const result = await Meteor.callAsync("user.hasAccess", []);
        assert.strictEqual(result, false);
      });

      it("user.getSubscriptionStatus rejects unauthenticated users", async function () {
        try {
          await Meteor.callAsync("user.getSubscriptionStatus");
          assert.fail("Should have thrown an error");
        } catch (error) {
          assert.strictEqual(error.error, "not-authorized");
        }
      });
    });

    describe("Games Collection", function () {
      it("Games collection exists", async function () {
        const { Games } = await import("../imports/lib/collections/games.js");
        assert.ok(Games);
        assert.strictEqual(typeof Games.find, "function");
        assert.strictEqual(typeof Games.findOneAsync, "function");
        assert.strictEqual(typeof Games.insertAsync, "function");
      });
    });

    describe("CollectionItems Collection", function () {
      it("CollectionItems collection exists", async function () {
        const { CollectionItems } = await import("../imports/lib/collections/collectionItems.js");
        assert.ok(CollectionItems);
        assert.strictEqual(typeof CollectionItems.find, "function");
        assert.strictEqual(typeof CollectionItems.findOneAsync, "function");
        assert.strictEqual(typeof CollectionItems.insertAsync, "function");
      });
    });

    describe("Hub Client Functions", function () {
      it("exports required functions", async function () {
        const hubClient = await import("../imports/hub/client.js");
        
        assert.ok(typeof hubClient.hubApiRequest === "function");
        assert.ok(typeof hubClient.validateToken === "function");
        assert.ok(typeof hubClient.checkSubscriptionWithHub === "function");
        assert.ok(typeof hubClient.getUserInfo === "function");
        assert.ok(typeof hubClient.getHubPublicKey === "function");
      });
    });

    describe("Subscription Module", function () {
      it("exports required functions", async function () {
        const subscriptions = await import("../imports/hub/subscriptions.js");
        
        assert.ok(typeof subscriptions.checkSubscription === "function");
        assert.ok(typeof subscriptions.clearSubscriptionCache === "function");
        assert.ok(typeof subscriptions.getRequiredProducts === "function");
      });

      it("getRequiredProducts returns array", async function () {
        const { getRequiredProducts } = await import("../imports/hub/subscriptions.js");
        const products = getRequiredProducts();
        assert.ok(Array.isArray(products));
      });
    });
  }
});
