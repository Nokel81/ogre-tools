import get from 'lodash/fp/get';
import conforms from 'lodash/fp/conforms';
import filter from 'lodash/fp/filter';
import find from 'lodash/fp/find';
import findLast from 'lodash/fp/findLast';
import first from 'lodash/fp/first';
import forEach from 'lodash/fp/forEach';
import invoke from 'lodash/fp/invoke';
import isFunction from 'lodash/fp/isFunction';
import map from 'lodash/fp/map';
import matches from 'lodash/fp/matches';
import once from 'lodash/fp/once';
import sortBy from 'lodash/fp/sortBy';
import last from 'lodash/fp/last';
import join from 'lodash/fp/join';
import reject from 'lodash/fp/reject';
import tap from 'lodash/fp/tap';
import { pipeline } from '@ogre-tools/fp';
import isUndefined from 'lodash/fp/isUndefined';
import lifecycleEnum, { nonStoredInstanceKey } from './lifecycleEnum';
import getCycles from './getCycles/getCycles';

export default (...listOfGetRequireContexts) => {
  let injectables = [];
  let overridingInjectables = [];
  let sideEffectsArePrevented = false;
  let setupsHaveBeenRan = false;
  let setupsAreBeingRan = false;

  const injectableMap = new Map();

  const privateDi = {
    inject: (alias, instantiationParameter, context = []) => {
      const originalInjectable = getRelatedInjectable({
        injectables,
        alias,
        context,
      });

      const overriddenInjectable = getOverridingInjectable({
        overridingInjectables,
        alias,
      });

      const injectable = overriddenInjectable || originalInjectable;

      if (!setupsHaveBeenRan && !setupsAreBeingRan && injectable.setup) {
        throw new Error(
          `Tried to inject setuppable "${injectable.id}" before setups are ran.`,
        );
      }

      if (sideEffectsArePrevented && injectable.causesSideEffects) {
        throw new Error(
          `Tried to inject "${injectable.id}" when side-effects are prevented.`,
        );
      }

      return getInstance({
        injectable,
        instantiationParameter,
        di: privateDi,
        injectableMap,
        context,
      });
    },

    injectMany: (alias, instantiationParameter, context = []) =>
      pipeline(
        getRelatedInjectables({ injectables, alias }),

        map(injectable =>
          privateDi.inject(injectable, instantiationParameter, context),
        ),
      ),

    register: externalInjectable => {
      if (!externalInjectable.id) {
        throw new Error('Tried to register injectable without ID.');
      }

      if (injectables.find(matches({ id: externalInjectable.id }))) {
        throw new Error(
          `Tried to register multiple injectables for ID "${externalInjectable.id}"`,
        );
      }

      const lifecycle = externalInjectable.lifecycle || lifecycleEnum.singleton;

      const internalInjectable = {
        ...externalInjectable,

        lifecycle,

        // Todo: spread-ternary
        setup: externalInjectable.setup
          ? once(externalInjectable.setup)
          : undefined,

        getInstanceKey:
          externalInjectable.getInstanceKey || lifecycle.getInstanceKey,

        permitSideEffects: function () {
          this.causesSideEffects = false;
        },
      };

      injectables.push(internalInjectable);

      injectableMap.set(internalInjectable.id, new Map());
    },

    override: (alias, instantiateStub) => {
      const originalInjectable = pipeline(
        injectables,
        find(isRelatedTo(alias)),
      );

      if (!originalInjectable) {
        throw new Error(
          `Tried to override "${alias.id}" which is not registered.`,
        );
      }

      overridingInjectables.push({
        ...originalInjectable,
        causesSideEffects: false,
        instantiate: instantiateStub,
      });
    },

    unoverride: alias => {
      overridingInjectables = pipeline(
        overridingInjectables,
        reject(isRelatedTo(alias)),
      );
    },

    reset: () => {
      overridingInjectables = [];
    },

    runSetups: async () => {
      setupsAreBeingRan = true;
      const setupContext = new Map();

      const diForSetupsFor = setuppable => ({
        inject: async (alias, parameter) => {
          const targetSetuppable = injectables.find(
            conforms({
              id: x => x === alias.id,
              setup: isFunction,
            }),
          );

          if (targetSetuppable && setuppable.id !== targetSetuppable.id) {
            setupContext.get(setuppable.id).add(targetSetuppable.id);

            const cycles = getCycles(setupContext);

            if (cycles.length > 0) {
              const mostComplexCycle = pipeline(
                cycles,
                sortBy('length'),
                last,
                join('" -> "'),
              );

              throw new Error(
                `Cycle of setuppables encountered: "${mostComplexCycle}"`,
              );
            }

            await targetSetuppable.setup(diForSetupsFor(targetSetuppable));
          }

          return privateDi.inject(alias, parameter);
        },
      });

      await pipeline(
        injectables,
        filter('setup'),

        tap(
          forEach(setuppable => {
            setupContext.set(setuppable.id, new Set());
          }),
        ),

        map(async injectable => {
          const diForSetups = diForSetupsFor(injectable);
          await injectable.setup(diForSetups);
        }),

        tap(() => {
          setupsHaveBeenRan = true;
          setupsAreBeingRan = false;
        }),
      );
    },

    preventSideEffects: () => {
      sideEffectsArePrevented = true;
    },

    permitSideEffects: alias => {
      getRelatedInjectable({ injectables, alias }).permitSideEffects();
    },

    purge: alias => {
      const injectable = getRelatedInjectable({
        injectables,
        alias,
      });

      injectableMap.get(injectable.id).clear();
    },
  };

  listOfGetRequireContexts.forEach(getRequireContextForInjectables => {
    autoRegisterInjectables({ getRequireContextForInjectables, di: privateDi });
  });

  const publicDi = {
    ...privateDi,
    inject: (alias, parameter) => privateDi.inject(alias, parameter),
    injectMany: (alias, parameter) => privateDi.injectMany(alias, parameter),
  };

  return publicDi;
};

const autoRegisterInjectables = ({ getRequireContextForInjectables, di }) => {
  const requireContextForInjectables = getRequireContextForInjectables();

  pipeline(
    requireContextForInjectables,
    invoke('keys'),
    map(requireContextForInjectables),
    map('default'),
    forEach(di.register),
  );
};

const isRelatedTo = alias => injectable =>
  injectable.id === alias.id ||
  (injectable.injectionToken && injectable.injectionToken === alias);

const getRelatedInjectable = ({ injectables, alias, context }) => {
  const relatedInjectables = getRelatedInjectables({ injectables, alias });

  if (relatedInjectables.length === 0) {
    const errorContextString = [...context, { id: alias.id }]
      .map(get('id'))
      .join('" -> "');

    throw new Error(
      `Tried to inject non-registered injectable "${errorContextString}".`,
    );
  }

  if (relatedInjectables.length > 1) {
    throw new Error(
      `Tried to inject single injectable for injection token "${
        alias.id
      }" but found multiple injectables: "${relatedInjectables
        .map(relatedInjectable => relatedInjectable.id)
        .join('", "')}"`,
    );
  }

  return first(relatedInjectables);
};

const getRelatedInjectables = ({ injectables, alias }) =>
  pipeline(injectables, filter(isRelatedTo(alias)));

const getOverridingInjectable = ({ overridingInjectables, alias }) =>
  pipeline(overridingInjectables, findLast(isRelatedTo(alias)));

const getInstance = ({
  di,
  injectable,
  instantiationParameter,
  context: oldContext,
  injectableMap,
}) => {
  if (!injectable.instantiate) {
    throw new Error(
      `Tried to inject "${injectable.id}" when instantiation is not defined.`,
    );
  }

  const newContext = [...oldContext, { id: injectable.id }];

  const injectableCausingCycle = pipeline(
    oldContext,
    find({ id: injectable.id }),
  );

  if (injectableCausingCycle) {
    throw new Error(
      `Cycle of injectables encountered: "${newContext
        .map(get('id'))
        .join('" -> "')}"`,
    );
  }

  const instanceMap = injectableMap.get(injectable.id);

  const minimalDi = {
    inject: (alias, parameter) => di.inject(alias, parameter, newContext),

    injectMany: (alias, parameter) =>
      di.injectMany(alias, parameter, newContext),
  };

  const instanceKey = injectable.getInstanceKey(
    minimalDi,
    instantiationParameter,
  );

  const existingInstance = instanceMap.get(instanceKey);

  if (existingInstance) {
    return existingInstance;
  }

  const newInstance = injectable.instantiate(
    minimalDi,
    ...(isUndefined(instantiationParameter) ? [] : [instantiationParameter]),
  );

  if (instanceKey !== nonStoredInstanceKey) {
    instanceMap.set(instanceKey, newInstance);
  }

  return newInstance;
};
