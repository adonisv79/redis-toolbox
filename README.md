# redis-toolbox
![Redis toolbox banner](https://github.com/adonisv79/redis-toolbox/docs/images/banner.png)

Redis utilities that allows developers to utilize Redis for Session Management, Job Queue processing and so on.
## Installation
```
npm i redis-toolbox --save
```

***
# Session Tools
The session tools provided here allows you to turn your redis host into a session manager for anything. It is designed to be agnostic to any specific product type and are all promise based which can be used for Async/Await calls

## Sample Setup
```
import {
  RedisSessionManager, RedisSessionOptions, onRedisSessionErrorCallback, RedisSessionObject,
} from 'redis-toolbox';

const redisOptions: RedisSessionOptions = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '80', 10),
  db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB, 10) : undefined,
  password: process.env.REDIS_PASS,
  sessionMaxTTL: process.env.USER_SESSION_MAX_TTL ? parseInt(process.env.USER_SESSION_MAX_TTL, 10) : 21600,
  sessionRefreshTTL: true,
  sessionInactiveTTL: process.env.USER_SESSION_IDLE_TTL ? parseInt(process.env.USER_SESSION_IDLE_TTL, 10) : 1800,
};

const onSessionError: onRedisSessionErrorCallback = async (err: Error): Promise<boolean> => {
  // do whatever async tasks like send metrics, alerts, etc.
  console.log(`Error on session: ${err.message}`);
  return false;
};

const session = new RedisSessionManager(redisOptions, onSessionError);
```
### Session related imports from the toolbox
On the sample above, we first imported the major components of a redis session.
* RedisSessionManager - The class that encapsulates the session management
* RedisSessionOptions - An object that extends the RedisOptions (ioredis)
* onRedisSessionErrorCallback - Defines a function that will be called whenever an error occurs in the session
* RedisSessionObject - Defines the data that gets stored for the session

### RedisSessionOptions 
Next we had defined the redis options. The rest of the configurations are from ioredis (host, port, etc.) what is added are the 3 session behavior properties
* sessionMaxTTL (integer)(default 6 hours) - The maximum time (in seconds) a redis session instance lives (TTL). once the session reaches this, its gone for good
* sessionRefreshTTL (boolean)(default false) - Defines if the session expires by being idle. This allows you to create long sessionMaxTTL but enforce an auto session kill when the user shows no activity for lets say 5-15 minutes
* sessionInactiveTTL (integer)(default 30 minutes) - if sessionRefreshTTL is true, this is applied as the max idle time a user can have before the session times out.

### onRedisSessionErrorCallback 
After that we need to implement the error callback defined by onRedisSessionErrorCallback . This allows you the chance to perform anything necessary before the module throws an Error. You can send alerts, metrics etc. on this function. this expects a return value however of boolean. Returning true acknowledges that you have handled the error yourself and telling the module to "do not bother throwing the error". sending false makes the module proceed to throw the error.

### RedisSessionManager instance
Finally, we create a new session instance from RedisSessionManager. It requires only 2 parameters which we did in the 2nd and 3rd step. The RedisSessionOptions object and the Error callback.

***

We can now start utilizing the session functions
```
const newsession: RedisSessionObject = await session.createSession();
const samesession: RedisSessionObject = await session.retrieveSession(newsession.sessionId);
const delta = { name: 'Adonis Lee Villamor', email: 'adonisv79@gmail.com' }
const isUpdated = await session.updateSession(samesession.sessionId, delta as any); //isUpdated will be true if success
const isDestroyed = await session.destroySession(samesession.sessionID);
```
