import RedisClass, { RedisOptions, Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const redisSessKeyPrefix = 'usersession:';

let rclient: Redis;

/** A callback function that is called asynchronously whenever an error occurs */
export type onRedisSessionErrorCallback = (err: Error) => Promise<boolean>;

/** Structure which defines what is stored inside a redis session */
export type RedisSessionObject = {
  /** The unique session identifier */
  sessionId: string;
  /** The server timestamp as to when the session was created */
  sessionDate: number;
  [index: string]: any;
};

/** The RedisSessionOptions extends the ioredis options for adding fields focused on handling sessions */
export interface RedisSessionOptions extends RedisOptions {
  /** Defines (in seconds) the time before a session is forced to expire,
   * does not matter if user has actively shown activity. -1 means no expire.
   * this has a min value of 60 (1 minute) and max of 43200 (12 hours) */
  sessionMaxTTL: number;
  /** Defines the time limit (in seconds) of idleness a session will expire.
   * the TTL resets to the value of sessionRefreshTTL on each activity unless
   * sessionMaxTTL is reached. -1 indicates that it does not expire for inactivity
   * this has a min value of 60 (1 minute) and max of 1800 (30 minutes) */
  sessionInactiveTTL: number;
  /** Defines if the session TTL will reset if a user session updates. This is best when you
   * track a "last activity timestamp" in the session to trace if user is still alive */
  sessionRefreshTTL: boolean;
}

/** The RedisSessionManager allows developers to manage user sessions with a Redis instance */
export class RedisSessionManager {
  private sendError: onRedisSessionErrorCallback;

  private options: RedisSessionOptions;

  /**
   * Creates a new instance of the RedisSessionManager
   * @param options The redis options used to identify the redis connection, behaviour and session management config
   * @param onError The callback that is fired whenever an error is encountered by the module
   */
  constructor(options: RedisSessionOptions, onError: onRedisSessionErrorCallback) {
    if (options.sessionMaxTTL < 60) {
      throw new Error('REDIS_SESSION_MAX_TTL_TOO_SHORT');
    } else if (options.sessionMaxTTL > 43200) {
      throw new Error('REDIS_SESSION_MAX_TTL_EXCEED_LIMIT');
    } else if (options.sessionInactiveTTL < 60) {
      throw new Error('REDIS_SESSION_INACTIVE_TTL_TOO_SHORT');
    } else if (options.sessionInactiveTTL > 1800) {
      throw new Error('REDIS_SESSION_INACTIVE_TTL_EXCEED_LIMIT');
    }
    this.options = options;
    this.sendError = onError;
    rclient = new RedisClass(options);
  }

  /**
   * Gets or defines the 'actual' key name inside of redis
   * @param sessionId The unique Session Id
   */
  private getRedisSessionKey(sessionId: string): string {
    return `${redisSessKeyPrefix}${sessionId}`;
  }

  /**
   * Generates the new TTL depending on the RedisSessionOptions and the actual user session's start date
   * @param sessionDate The timestamp the user session started
   */
  private nextTTL(sessionDate: number): number {
    let newTTL = 0;
    const now = new Date().getTime();
    const secEllapsed = Math.round(now / 1000) - Math.round(sessionDate / 1000);
    const maxTTL = this.options.sessionMaxTTL - secEllapsed;
    if (maxTTL > 0) {
      if (this.options.sessionRefreshTTL && this.options.sessionInactiveTTL < maxTTL) {
        newTTL = this.options.sessionInactiveTTL;
      } else {
        newTTL = maxTTL;
      }
    }
    return newTTL;
  }

  /** Test (ping) connection to see if the redis connection works */
  async testConnection(): Promise<boolean> {
    try {
      const ping = await rclient.ping();
      if (ping !== 'pong') {
        throw new Error('REDIS_SESSION_CONNECTION_FAILED');
      }
      return true;
    } catch (err) {
      this.sendError(err);
    }
    return false;
  }

  /**
   * Refreshes the session's TTL which is affected by the sessionMaxTTL and
   * the sessionRefreshTTL of the RedisSessionOptions
   * @param sessionId The unique Session Id
   */
  async refreshSessionTTL(sessionId: string): Promise<boolean> {
    try {
      const sObj = await this.retrieveSession(sessionId);
      const newTTL = this.nextTTL(sObj.sessionDate);
      if (newTTL > 0) {
        const result = await rclient.expire(this.getRedisSessionKey(sessionId), newTTL);
        if (result !== 1) {
          throw new Error('REDIS_SESSION_REFRESH_TOKEN_FAILED');
        }
      }
      return true;
    } catch (err) {
      const handled: boolean = await this.sendError(err);
      if (!handled) {
        throw err;
      }
    }
    return false;
  }

  /**
   * Retrieves the user session's TTL (in seco0nds)
   * @param sessionId The unique Session Id
   */
  async getTTL(sessionId: string): Promise<number> {
    try {
      return await rclient.ttl(this.getRedisSessionKey(sessionId));
    } catch (err) {
      const handled: boolean = await this.sendError(err);
      if (!handled) {
        throw err;
      }
    }
    return -2;
  }

  /** Creates a new user session */
  async createSession(): Promise<RedisSessionObject> {
    const sObj: RedisSessionObject = { sessionDate: 0, sessionId: '' };
    try {
      const sessionDate = new Date().getTime();
      const sessionId = uuidv4();
      sObj.sessionDate = sessionDate;
      sObj.sessionId = sessionId;
      const ttl = this.nextTTL(sessionDate);
      await rclient.setex(this.getRedisSessionKey(sessionId), ttl, JSON.stringify(sObj));
    } catch (err) {
      const handled: boolean = await this.sendError(err);
      if (!handled) {
        throw err;
      }
    }
    return sObj;
  }

  /**
   * Retrieves the user session object
   * @param sessionId The unique Session Id
   */
  async retrieveSession(sessionId: string): Promise<RedisSessionObject> {
    let sObj: RedisSessionObject = { sessionDate: 0, sessionId: '' };
    try {
      const result = await rclient.get(this.getRedisSessionKey(sessionId));
      if (!result) {
        throw new Error('REDIS_SESSION_NOT_SET');
      }
      sObj = JSON.parse(result);
    } catch (err) {
      const handled: boolean = await this.sendError(err);
      if (!handled) {
        throw err;
      }
    }
    return sObj;
  }

  /**
   * Updates the user session object
   * @param sessionId The unique Session Id
   * @param delta The object showing the values that will change
   */
  async updateSession(sessionId: string, delta: RedisSessionObject): Promise<boolean> {
    try {
      if (delta.sessionId || delta.sessionDate || delta.ttl) {
        throw new Error('REDIS_SESSION_INVALID_UPDATE_ON_SECURED_FIELDS');
      }
      const oldSession: RedisSessionObject = await this.retrieveSession(sessionId);
      const newSession = { ...oldSession, ...delta };
      const ttl = this.nextTTL(newSession.sessionDate);
      await rclient.setex(
        this.getRedisSessionKey(sessionId), ttl, JSON.stringify(newSession),
      );
      return true;
    } catch (err) {
      const handled: boolean = await this.sendError(err);
      if (!handled) {
        throw err;
      }
    }
    return false;
  }

  /**
   * Deletes the user session object
   * @param sessionId The unique Session Id
   */
  async destroySession(sessionId: string): Promise<boolean> {
    const key = this.getRedisSessionKey(sessionId);
    const result = await rclient.exists(key);
    if (result) { // just delete
      await rclient.del(key);
    }
    return true;
  }
}
