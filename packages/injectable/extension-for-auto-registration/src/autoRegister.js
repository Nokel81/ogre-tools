import { flatMap, forEach, tap, set } from 'lodash/fp';
import { pipeline } from '@ogre-tools/fp';
import { isInjectable } from '@ogre-tools/injectable';
import requireContextFake from './requireContextFake';

const getFileNameAndModule = requireContext =>
  requireContext.keys().map(key => [key, requireContext(key)]);

const registerInjectableFor =
  di =>
  ([, module]) => {
    di.register(...Object.values(module).filter(isInjectable));
  };

const verifyFiles = fileNamesAndModules => {
  if (fileNamesAndModules.length === 0) {
    throw new Error(
      'Tried to auto-register injectables, but no matching files were found',
    );
  }
};

const verifyInjectables = ([[fileName, module]]) => {
  const injectables = Object.entries(module).filter(([, exported]) =>
    isInjectable(exported),
  );

  if (injectables.length === 0) {
    throw new Error(
      `Tried to register injectables from "${fileName}", but there were none"`,
    );
  }
};

export default ({ fs, path }) =>
  ({ di, targetModule, getRequireContexts }) => {
    if (targetModule.require && !targetModule.require.context) {
      targetModule.require.context = requireContextFake({
        targetModule: targetModule,
        fs,
        path,
      });
    }

    pipeline(
      getRequireContexts(),
      flatMap(getFileNameAndModule),
      tap(verifyFiles),
      tap(verifyInjectables),
      forEach(registerInjectableFor(di)),
    );
  };