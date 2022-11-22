import flow from './fastFlow';
import getInjectionToken from '../getInjectionToken/getInjectionToken';
import { nonStoredInstanceKey } from './lifecycleEnum';
import getInjectable from '../getInjectable/getInjectable';
import { isPromise } from '@ogre-tools/fp';

export default containerId => {
  let injectableMap = new Map();
  let overridingInjectables = new Map();
  let sideEffectsArePrevented = false;
  let alreadyInjected = new Set();

  const injectableAndRegistrationContext = new Map();
  const instancesByInjectableMap = new Map();
  const injectableIdsByInjectionToken = new Map();

  const getInjectablesHavingInjectionToken =
    getInjectablesHavingInjectionTokenFor({
      injectableMap,
      injectableIdsByInjectionToken,
    });

  const getRelatedInjectables = getRelatedInjectablesFor({
    injectableMap,
    getInjectablesHavingInjectionToken,
  });

  const getRelatedInjectable = getRelatedInjectableFor({
    getRelatedInjectables,
  });

  const privateInject = (alias, instantiationParameter, context = []) => {
    const relatedInjectables = getRelatedInjectables(alias);

    checkForTooManyMatches(relatedInjectables, alias);

    if (relatedInjectables.length === 0 && alias.adHoc === true) {
      privateDi.register(alias);
    } else {
      checkForNoMatches(relatedInjectables, alias, context);
    }

    const originalInjectable = getRelatedInjectable(alias);

    alreadyInjected.add(originalInjectable.id);

    const overriddenInjectable = overridingInjectables.get(
      originalInjectable.id,
    );

    const injectable = overriddenInjectable || originalInjectable;

    if (sideEffectsArePrevented && injectable.causesSideEffects) {
      throw new Error(
        `Tried to inject "${[...context, { injectable }]
          .map(item => item.injectable.id)
          .join('" -> "')}" when side-effects are prevented.`,
      );
    }

    return getInstance({
      injectable,
      instantiationParameter,
      di: privateDi,
      instancesByInjectableMap,
      context,
      injectableAndRegistrationContext,
    });
  };

  const nonDecoratedPrivateInjectMany = (
    injectionToken,
    instantiationParameter,
    oldContext = [containerRootContextItem],
  ) => {
    const newContext = [...oldContext, { injectable: injectionToken }];

    const relatedInjectables = getRelatedInjectables(injectionToken);

    const injected = relatedInjectables.map(injectable =>
      decoratedPrivateInject(injectable, instantiationParameter, newContext),
    );

    if (injected.find(isPromise)) {
      return Promise.all(injected);
    }

    return injected;
  };

  const withInjectionDecorators = withInjectionDecoratorsFor({
    injectMany: nonDecoratedPrivateInjectMany,
  });

  const decoratedPrivateInject = withInjectionDecorators(privateInject);

  const decoratedPrivateInjectMany = withInjectionDecorators(
    nonDecoratedPrivateInjectMany,
  );

  const registerSingle = externalInjectable => {
    let injectableId = externalInjectable.id;

    if (!injectableId) {
      throw new Error('Tried to register injectable without ID.');
    }

    if (injectableMap.has(injectableId)) {
      throw new Error(
        `Tried to register multiple injectables for ID "${injectableId}"`,
      );
    }

    const internalInjectable = {
      ...externalInjectable,

      permitSideEffects: function () {
        this.causesSideEffects = false;
      },
    };

    injectableMap.set(internalInjectable.id, internalInjectable);
    instancesByInjectableMap.set(internalInjectable.id, new Map());

    if (externalInjectable.injectionToken) {
      const tokenId = externalInjectable.injectionToken.id;

      const injectableIdsSet =
        injectableIdsByInjectionToken.get(tokenId) || new Set();

      injectableIdsSet.add(injectableId);

      injectableIdsByInjectionToken.set(tokenId, injectableIdsSet);
    }
  };

  const purgeInstances = alias => {
    const injectable = getRelatedInjectable(alias);

    instancesByInjectableMap.get(injectable.id).clear();
  };

  const deregisterSingle = alias => {
    const relatedInjectable = injectableMap.get(alias.id);

    if (!relatedInjectable) {
      throw new Error(
        `Tried to deregister non-registered injectable "${alias.id}".`,
      );
    }

    [...injectableAndRegistrationContext.entries()]
      .filter(([, context]) =>
        context.find(contextItem => contextItem.injectable.id === alias.id),
      )
      .map(x => x[0])
      .forEach(injectable => {
        injectableAndRegistrationContext.delete(injectable);
        privateDi.deregister(injectable);
      });

    purgeInstances(alias);

    injectableMap.delete(alias.id);

    if (alias.injectionToken) {
      const tokenId = alias.injectionToken.id;

      const injectableIdSet = injectableIdsByInjectionToken.get(tokenId);

      injectableIdSet.delete(alias.id);
    }

    overridingInjectables.delete(alias.id);
  };

  const decorate = (alias, decorator) => {
    const decoratorInjectable = getInjectable({
      id: `${alias.id}-decorator-${Math.random()}`,
      injectionToken: injectionDecoratorToken,
      decorable: false,

      instantiate: () => ({
        decorate: decorator,
        target: alias,
      }),
    });

    registerSingle(decoratorInjectable);
  };

  const privateDi = {
    inject: decoratedPrivateInject,

    injectMany: decoratedPrivateInjectMany,

    register: (...injectables) => {
      injectables.forEach(injectable => {
        registerSingle(injectable);
      });

      const callbacks = nonDecoratedPrivateInjectMany(
        registrationCallbackToken,
      );

      injectables.forEach(injectable => {
        callbacks.forEach(callback => {
          callback(injectable);
        });
      });
    },

    deregister: (...injectables) => {
      const callbacks = nonDecoratedPrivateInjectMany(
        deregistrationCallbackToken,
      );

      injectables.forEach(injectable => {
        callbacks.forEach(callback => {
          callback(injectable);
        });
      });

      injectables.forEach(injectable => {
        deregisterSingle(injectable);
      });
    },

    decorate,

    decorateFunction: (alias, decorator) => {
      decorate(
        alias,
        toBeDecorated =>
          (...instantiation) =>
            decorator(toBeDecorated(...instantiation)),
      );
    },

    override: (alias, instantiateStub) => {
      const relatedInjectables = getRelatedInjectables(alias);

      if (relatedInjectables.length > 1) {
        throw new Error(
          `Tried to override single implementation of injection token "${
            alias.id
          }", but found multiple registered implementations: "${relatedInjectables
            .map(x => x.id)
            .join('", "')}".`,
        );
      }

      if (relatedInjectables.length === 0) {
        if (alias.aliasType === 'injection-token') {
          throw new Error(
            `Tried to override single implementation of injection token "${alias.id}", but found no registered implementations.`,
          );
        }

        throw new Error(
          `Tried to override "${alias.id}" which is not registered.`,
        );
      }

      if (alreadyInjected.has(alias.id)) {
        throw new Error(
          `Tried to override injectable "${alias.id}", but it was already injected.`,
        );
      }

      const originalInjectable = relatedInjectables[0];

      overridingInjectables.set(originalInjectable.id, {
        ...originalInjectable,
        causesSideEffects: false,
        instantiate: instantiateStub,
      });
    },

    unoverride: alias => {
      overridingInjectables.delete(alias.id);
    },

    reset: () => {
      overridingInjectables.clear();
    },

    preventSideEffects: () => {
      sideEffectsArePrevented = true;
    },

    permitSideEffects: alias => {
      getRelatedInjectable(alias).permitSideEffects();
    },

    purge: purgeInstances,
  };

  const containerRootContextItem = { injectable: { id: containerId } };

  const publicDi = {
    ...privateDi,

    inject: (alias, parameter, customContextItem) =>
      privateDi.inject(
        alias,
        parameter,
        customContextItem
          ? [containerRootContextItem, customContextItem]
          : [containerRootContextItem],
      ),

    injectMany: (alias, parameter, customContextItem) =>
      privateDi.injectMany(
        alias,
        parameter,
        customContextItem
          ? [containerRootContextItem, customContextItem]
          : [containerRootContextItem],
      ),
  };

  return publicDi;
};

const isRelatedTo = alias => injectable =>
  injectable.id === alias.id ||
  (injectable.injectionToken && injectable.injectionToken.id === alias.id);

const getRelatedInjectableFor =
  ({ getRelatedInjectables }) =>
  alias =>
    getRelatedInjectables(alias)[0];

const getInjectablesHavingInjectionTokenFor =
  ({ injectableMap, injectableIdsByInjectionToken }) =>
  alias => {
    const idSetForInjectablesHavingInjectionToken =
      injectableIdsByInjectionToken.get(alias.id);

    const idsForInjectablesHavingInjectionToken =
      idSetForInjectablesHavingInjectionToken
        ? [...idSetForInjectablesHavingInjectionToken.values()]
        : [];

    return idsForInjectablesHavingInjectionToken.map(injectableId =>
      injectableMap.get(injectableId),
    );
  };

const getRelatedInjectablesFor =
  ({ injectableMap, getInjectablesHavingInjectionToken }) =>
  alias => {
    const injectable = injectableMap.get(alias.id);

    const injectablesHavingInjectionToken = getInjectablesHavingInjectionToken(
      alias,
    ).filter(x => x.id !== alias.id);

    return injectable
      ? [injectable, ...injectablesHavingInjectionToken]
      : injectablesHavingInjectionToken;
  };

const getInstance = ({
  di,
  injectable: injectableToBeInstantiated,
  instantiationParameter,
  context: oldContext,
  instancesByInjectableMap,
  injectableAndRegistrationContext,
}) => {
  const newContext = [
    ...oldContext,

    {
      injectable: injectableToBeInstantiated,
      instantiationParameter,
    },
  ];

  const instanceMap = instancesByInjectableMap.get(
    injectableToBeInstantiated.id,
  );

  const minimalDi = {
    inject: (alias, parameter) => di.inject(alias, parameter, newContext),

    injectMany: (alias, parameter) =>
      di.injectMany(alias, parameter, newContext),

    context: newContext,

    register: (...injectables) => {
      injectables.forEach(injectableToBeRegistered => {
        injectableAndRegistrationContext.set(
          injectableToBeRegistered,
          newContext,
        );
      });

      return di.register(...injectables);
    },

    deregister: di.deregister,
  };

  const instanceKey = injectableToBeInstantiated.lifecycle.getInstanceKey(
    minimalDi,
    instantiationParameter,
  );

  const existingInstance = instanceMap.get(instanceKey);

  if (existingInstance) {
    return existingInstance;
  }

  const withInstantiationDecorators = withInstantiationDecoratorsFor({
    injectMany: di.injectMany,
    injectable: injectableToBeInstantiated,
  });

  const instantiateWithDecorators = withInstantiationDecorators(
    injectableToBeInstantiated.instantiate,
  );

  const newInstance = instantiateWithDecorators(
    minimalDi,
    ...(instantiationParameter === undefined ? [] : [instantiationParameter]),
  );

  if (instanceKey !== nonStoredInstanceKey) {
    instanceMap.set(instanceKey, newInstance);
  }

  return newInstance;
};

export const registrationCallbackToken = getInjectionToken({
  id: 'registration-callback-token',
  decorable: false,
});

export const deregistrationCallbackToken = getInjectionToken({
  id: 'deregistration-callback-token',
  decorable: false,
});

export const instantiationDecoratorToken = getInjectionToken({
  id: 'instantiate-decorator-token',
  decorable: false,
});

export const injectionDecoratorToken = getInjectionToken({
  id: 'injection-decorator-token',
  decorable: false,
});

const withInstantiationDecoratorsFor = ({ injectMany, injectable }) => {
  const isRelevantDecorator = isRelevantDecoratorFor(injectable);

  return toBeDecorated =>
    (...args) => {
      if (injectable.decorable === false) {
        return toBeDecorated(...args);
      }

      const [{ context }] = args;

      const decorators = injectMany(
        instantiationDecoratorToken,
        undefined,
        context,
      )
        .filter(isRelevantDecorator)
        .map(x => x.decorate);

      const decorated = flow(...decorators)(toBeDecorated);

      return decorated(...args);
    };
};

const withInjectionDecoratorsFor =
  ({ injectMany }) =>
  toBeDecorated =>
  (alias, ...args) => {
    if (alias.decorable === false) {
      return toBeDecorated(alias, ...args);
    }

    const [, oldContext] = args;

    const injectableCausingCycle = oldContext
      .filter(contextItem => !contextItem.injectable.cannotCauseCycles)
      .find(contextItem => contextItem.injectable.id === alias.id);

    const newContext = [...oldContext, { injectable: alias }];

    if (injectableCausingCycle) {
      throw new Error(
        `Cycle of injectables encountered: "${newContext
          .map(x => x.injectable.id)
          .join('" -> "')}"`,
      );
    }

    const isRelevantDecorator = isRelevantDecoratorFor(alias);

    const decorators = injectMany(
      injectionDecoratorToken,
      undefined,
      newContext,
    )
      .filter(isRelevantDecorator)
      .map(x => x.decorate);

    const decorated = flow(...decorators)(toBeDecorated);

    return decorated(alias, ...args);
  };

const isRelevantDecoratorFor = injectable => decorator =>
  !decorator.target || isRelatedTo(decorator.target)(injectable);

const checkForNoMatches = (relatedInjectables, alias, context) => {
  if (relatedInjectables.length === 0) {
    const errorContextString = [...context, { injectable: { id: alias.id } }]
      .map(x => x.injectable.id)
      .join('" -> "');

    throw new Error(
      `Tried to inject non-registered injectable "${errorContextString}".`,
    );
  }
};

const checkForTooManyMatches = (relatedInjectables, alias) => {
  if (relatedInjectables.length > 1) {
    throw new Error(
      `Tried to inject single injectable for injection token "${
        alias.id
      }" but found multiple injectables: "${relatedInjectables
        .map(relatedInjectable => relatedInjectable.id)
        .join('", "')}"`,
    );
  }
};