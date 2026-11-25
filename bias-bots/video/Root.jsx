import { Composition } from 'remotion';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/unbounded/800.css';
import { BiasReel } from './BiasReel.jsx';
import { buildTimeline, defaultHighlight, FPS } from './timeline.mjs';

const sample = {
  bias: {
    n: 130, total: 187, name: 'Ошибка невозвратных затрат', accent: '#a3e635', quadrantTitle: 'Нужно действовать быстро',
    summary: 'Продолжаем вкладываться во что-то, потому что уже много вложили.',
    example: 'Досматриваете скучный фильм, «раз уж заплатили за билет».',
    tip: 'Прошлое не вернуть. Решайте только по будущим выгодам и затратам.',
  },
  hook: 'Почему мы досматриваем скучное кино до конца?',
  cta: 'Ещё 186 ловушек мышления — в боте',
  handle: '@BiasCodexBot',
  wheel: [],
  card: null,
};

export const Root = () => (
  <Composition
    id="BiasReel"
    component={BiasReel}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={600}
    defaultProps={sample}
    calculateMetadata={({ props }) => {
      const timeline = props.timeline ?? buildTimeline({ hook: props.hook, ...props.bias });
      return {
        durationInFrames: timeline.total,
        props: {
          ...props,
          timeline,
          highlight: props.highlight ?? {
            what: defaultHighlight(props.bias.summary),
            tip: props.bias.tip ? defaultHighlight(props.bias.tip) : '',
          },
        },
      };
    }}
  />
);
