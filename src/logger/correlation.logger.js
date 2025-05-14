import cls from 'cls-hooked';
import { v4 as uuidv4 } from 'uuid';

const store = cls.createNamespace('correlation-id-namespace');

const correlationIds = {
  set: (correlationId) => {
    store.set('correlationId', correlationId);
  },
  get: () => {
    return store.get('correlationId');
  },
  bindEmitter: (emitter) => {
    store.bindEmitter(emitter);
  },
  bind: (fn) => {
    return store.bind(fn);
  },
  middleware: (req, res, next) => {
    store.run(() => {
      correlationIds.set(req.headers['x-correlation-id'] || uuidv4());
      next();
    });
  }
};

export default correlationIds;
