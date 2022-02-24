import getDi from '../test-utils/getDiForUnitTesting';
import getInjectable from '../getInjectable/getInjectable';
import {
  plantUmlDependencyGraphInjectable,
  registerDependencyGraphing,
} from './extensions/dependency-graphing/dependency-graphing';
import getInjectionToken from '../getInjectionToken/getInjectionToken';
import lifecycleEnum from './lifecycleEnum';

describe('createContainer.dependency-graph', () => {
  it('given dependency graphing, dependencies and injected, creates Plant-UML graph', async () => {
    const parentInjectable = getInjectable({
      id: 'some-parent-injectable',

      instantiate: di => di.inject(childInjectable),
    });

    const childInjectable = getInjectable({
      id: 'some-child-injectable',
      instantiate: di => di.injectMany(injectionToken),
      lifecycle: lifecycleEnum.transient,
    });

    const injectionToken = getInjectionToken({ id: 'some-injection-token' });
    const tokenInjectable = getInjectable({
      id: 'some-token-injectable',
      instantiate: () => 'irrelevant',
      injectionToken,
    });

    const setuppableInjectable = getInjectable({
      id: 'some-setuppable',
      instantiate: () => 'irrelevant',
      setup: di => {
        di.inject(childInjectable);
        di.inject(setuppableInjectable);
      },
    });

    const di = getDi(
      parentInjectable,
      childInjectable,
      tokenInjectable,
      setuppableInjectable,
    );

    registerDependencyGraphing(di);

    await di.runSetups();

    di.inject(parentInjectable);

    const graph = di.inject(plantUmlDependencyGraphInjectable);

    expect(graph).toMatchSnapshot();
  });
});