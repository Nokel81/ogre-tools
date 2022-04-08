import getInjectable from '../getInjectable/getInjectable';
import createContainer from './createContainer';

describe('createContainer.deregistration', () => {
  it('given registered injectable and deregistered, when injecting, throws', () => {
    const di = createContainer();

    const someInjectable = getInjectable({
      id: 'some-injectable',
      instantiate: () => 'irrelevant',
    });

    di.register(someInjectable);

    di.deregister(someInjectable);

    expect(() => {
      di.inject(someInjectable);
    }).toThrow('Tried to inject non-registered injectable "some-injectable".');
  });

  it('given multiple registered injectables and deregistered, when injecting, throws', () => {
    const di = createContainer();

    const someInjectable = getInjectable({
      id: 'some-injectable',
      instantiate: () => 'irrelevant',
    });

    const someOtherInjectable = getInjectable({
      id: 'some-other-injectable',
      instantiate: () => 'irrelevant',
    });

    di.register(someInjectable, someOtherInjectable);

    di.deregister(someInjectable, someOtherInjectable);

    expect(() => {
      di.inject(someOtherInjectable);
    }).toThrow(
      'Tried to inject non-registered injectable "some-other-injectable".',
    );
  });

  it('given not registered, when still deregistering, throws', () => {
    const di = createContainer();

    const someInjectable = getInjectable({
      id: 'some-injectable',
      instantiate: () => 'irrelevant',
    });

    expect(() => {
      di.deregister(someInjectable);
    }).toThrow(
      'Tried to deregister non-registered injectable "some-injectable".',
    );
  });

  it('given registered injectable and overridden and deregistered and registered again, when injecting, injects non-overridden instance', () => {
    const di = createContainer();

    const someInjectable = getInjectable({
      id: 'some-injectable',
      instantiate: () => 'some-instance',
    });

    di.register(someInjectable);
    di.override(someInjectable, () => 'some-overridden-instance');
    di.deregister(someInjectable);

    di.register(someInjectable);

    const actual = di.inject(someInjectable);
    expect(actual).toBe('some-instance');
  });

  it('given injectable and injectable which can deregister and first injectable is deregistered, when first injectable is injected, throws', () => {
    const di = createContainer();

    const someInjectable = getInjectable({
      id: 'some-injectable',
      instantiate: () => 'some-instance',
    });

    const deregisterInjectable = getInjectable({
      id: 'deregister',

      instantiate: di => injectable => {
        di.deregister(injectable);
      },
    });

    di.register(someInjectable, deregisterInjectable);

    const deregister = di.inject(deregisterInjectable);

    deregister(someInjectable);

    expect(() => {
      di.inject(someInjectable);
    }).toThrow('Tried to inject non-registered injectable "some-injectable".');
  });
});
