import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { DDP } from 'meteor/ddp-client';
import { DDPCommon } from 'meteor/ddp-common';

/**
 * Create a test user in the database
 * @param {Object} overrides - Fields to override defaults
 * @returns {string} userId
 */
export async function createTestUser(overrides = {}) {
  const userId = Random.id();
  const defaultUser = {
    _id: userId,
    username: `testuser_${userId.slice(0, 6)}`,
    emails: [{ address: `test_${userId.slice(0, 6)}@example.com`, verified: false }],
    createdAt: new Date(),
    services: {},
    ...overrides
  };

  await Meteor.users.insertAsync(defaultUser);
  return userId;
}

/**
 * Invoke a Meteor method as a specific user.
 * Creates a proper DDP method invocation context with userId set.
 *
 * @param {string} userId - The user ID to call as
 * @param {string} methodName - The method name to call
 * @param {...*} args - Arguments to pass to the method
 * @returns {*} Method return value
 */
export async function callAsUser(userId, methodName, ...args) {
  const invocation = new DDPCommon.MethodInvocation({
    userId: userId,
    isSimulation: false,
    connection: null
  });

  return DDP._CurrentMethodInvocation.withValue(invocation, async () => {
    const handler = Meteor.server.method_handlers[methodName];
    if (!handler) {
      throw new Error(`Method "${methodName}" not found`);
    }
    return handler.apply(invocation, args);
  });
}

/**
 * Remove a test user from the database
 * @param {string} userId
 */
export async function removeTestUser(userId) {
  await Meteor.users.removeAsync(userId);
}
