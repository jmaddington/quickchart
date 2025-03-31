const canvas = require('canvas');
const deepmerge = require('deepmerge');
const pattern = require('patternomaly');
const { CanvasRenderService } = require('chartjs-node-canvas');

const { fixNodeVmObject } = require('./util');
const { logger } = require('../logging');
const { uniqueSvg } = require('./svg');

/**
 * Validates a string to ensure it only contains a safe chart configuration
 * @param {string} input The chart configuration string to validate
 * @returns {boolean} True if the input is a safe chart configuration
 */
function isValidChartConfig(input) {
  // List of dangerous patterns that could indicate code injection
  const dangerousPatterns = [
    /\beval\s*\(/i, // eval()
    /\bFunction\s*\(/i, // Function constructor
    /\bsetTimeout\s*\(/i, // setTimeout
    /\bsetInterval\s*\(/i, // setInterval
    /\brequire\s*\(/i, // require
    /\bimport\s*\(/i, // import()
    /\bprocess\b/i, // process object
    /\bglobal\b/i, // global object
    /\b__dirname\b/i, // __dirname
    /\b__filename\b/i, // __filename
    /\bconstructor\b.*\bprototype\b/i, // prototype pollution
    /\bObject\s*\.\s*([gs]et)?[pP]rototype[oO]f\b/i, // prototype manipulation
    /\bdocument\b/i, // DOM access
    /\bwindow\b/i, // window object
    /\blocation\b/i, // location object
    /\bnavigator\b/i, // navigator object
    /\bfetch\b/i, // fetch API
    /\bXMLHttpRequest\b/i, // XHR
    /\bWebSocket\b/i, // WebSocket
    /\balert\b/i, // alert
    /\bconfirm\b/i, // confirm
    /\bprompt\b/i, // prompt
    /\blocalStorage\b/i, // localStorage
    /\bsessionStorage\b/i, // sessionStorage
    /\bindexedDB\b/i, // indexedDB
    /\bfs\b/i, // filesystem
    /\bhttps?\b/i, // http/https modules
    /\bnet\b/i, // net module
    /\bchild_process\b/i, // child_process module
    /\bcrypto\b/i, // crypto module
    /\bzlib\b/i, // zlib module
    /\bdgram\b/i, // dgram module
    /<(\w+)>/i, // HTML tags
    /\(\s*\)\s*=>/i, // arrow functions
    /\bfunction\s*\(/i, // function declarations
    /\bnew\s+/i, // new keyword
    /\bdelete\b/i, // delete operator
  ];

  // Check if the input contains any dangerous patterns
  for (const pattern of dangerousPatterns) {
    if (pattern.test(input)) {
      return false;
    }
  }

  // Basic structure validation - ensure the input starts with a chart-like object
  const validStartPatterns = [
    /^\s*{/, // Object literal
    /^\s*\(\s*{/, // Parenthesized object literal
    /^\s*\{\s*type\s*:/i, // Object with type property
  ];

  let isValidStart = false;
  for (const pattern of validStartPatterns) {
    if (pattern.test(input)) {
      isValidStart = true;
      break;
    }
  }

  if (!isValidStart) {
    return false;
  }

  // Check for balanced curly braces as a basic syntax check
  let braceCount = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === stringChar) {
        inString = false;
      }
    } else if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
    } else if (char === '{') {
      braceCount++;
    } else if (char === '}') {
      braceCount--;
      if (braceCount < 0) {
        return false; // Unbalanced braces
      }
    }
  }

  return braceCount === 0 && !inString;
}

// Polyfills
require('canvas-5-polyfill');
global.CanvasGradient = canvas.CanvasGradient;

// Constants
const ROUND_CHART_TYPES = new Set([
  'pie',
  'doughnut',
  'polarArea',
  'outlabeledPie',
  'outlabeledDoughnut',
]);

const BOXPLOT_CHART_TYPES = new Set(['boxplot', 'horizontalBoxplot', 'violin', 'horizontalViolin']);

const MAX_HEIGHT = process.env.CHART_MAX_HEIGHT || 3000;
const MAX_WIDTH = process.env.CHART_MAX_WIDTH || 3000;

const rendererCache = {};

async function getChartJsForVersion(version) {
  if (version && version.startsWith('4')) {
    return (await import('chart.js-v4/auto')).Chart;
  }
  if (version && version.startsWith('3')) {
    return require('chart.js-v3');
  }
  return require('chart.js');
}

async function getRenderer(width, height, version, format) {
  if (width > MAX_WIDTH) {
    throw `Requested width exceeds maximum of ${MAX_WIDTH}`;
  }
  if (height > MAX_HEIGHT) {
    throw `Requested width exceeds maximum of ${MAX_WIDTH}`;
  }

  const key = `${width}__${height}__${version}__${format}`;
  if (!rendererCache[key]) {
    const Chart = await getChartJsForVersion(version);
    rendererCache[key] = new CanvasRenderService(width, height, undefined, format, () => Chart);
  }
  return rendererCache[key];
}

function addColorsPlugin(chart) {
  if (chart.options && chart.options.plugins && chart.options.plugins.colorschemes) {
    return;
  }

  chart.options = deepmerge.all([
    {},
    chart.options,
    {
      plugins: {
        colorschemes: {
          scheme: 'tableau.Tableau10',
        },
      },
    },
  ]);
}

function getGradientFunctions(width, height) {
  const getGradientFill = (colorOptions, linearGradient = [0, 0, width, 0]) => {
    return function colorFunction() {
      const ctx = canvas.createCanvas(20, 20).getContext('2d');
      const gradientFill = ctx.createLinearGradient(...linearGradient);
      colorOptions.forEach((options, idx) => {
        gradientFill.addColorStop(options.offset, options.color);
      });
      return gradientFill;
    };
  };

  const getGradientFillHelper = (direction, colors, dimensions = {}) => {
    const colorOptions = colors.map((color, idx) => {
      return {
        color,
        offset: idx / (colors.length - 1 || 1),
      };
    });

    let linearGradient = [0, 0, dimensions.width || width, 0];
    if (direction === 'vertical') {
      linearGradient = [0, 0, 0, dimensions.height || height];
    } else if (direction === 'both') {
      linearGradient = [0, 0, dimensions.width || width, dimensions.height || height];
    }
    return getGradientFill(colorOptions, linearGradient);
  };

  return {
    getGradientFill,
    getGradientFillHelper,
  };
}

function patternDraw(shapeType, backgroundColor, patternColor, requestedSize) {
  return function doPatternDraw() {
    const size = Math.min(200, requestedSize) || 20;
    // patternomaly requires a document global...
    global.document = {
      createElement: () => {
        return canvas.createCanvas(size, size);
      },
    };
    return pattern.draw(shapeType, backgroundColor, patternColor, size);
  };
}

async function renderChartJs(
  width,
  height,
  backgroundColor,
  devicePixelRatio,
  version,
  format,
  untrustedChart,
) {
  let chart;
  if (typeof untrustedChart === 'string') {
    // First, try to parse as JSON
    try {
      chart = JSON.parse(untrustedChart);
    } catch (jsonErr) {
      // If it's not valid JSON, it might be a JavaScript object literal
      // Try to validate and sanitize it before evaluation
      if (isValidChartConfig(untrustedChart)) {
        try {
          const { getGradientFill, getGradientFillHelper } = getGradientFunctions(width, height);
          // Use indirect eval in a controlled context
          const chartFunction = new Function(
            'getGradientFill',
            'getGradientFillHelper',
            'pattern',
            'Chart',
            `"use strict"; return ${untrustedChart}`,
          );
          chart = chartFunction(
            getGradientFill,
            getGradientFillHelper,
            { draw: patternDraw },
            getChartJsForVersion(version),
          );
        } catch (evalErr) {
          logger.error('Input Error', evalErr, untrustedChart);
          return Promise.reject(new Error(`Invalid input\n${evalErr}`));
        }
      } else {
        logger.error('Invalid chart configuration format', jsonErr, untrustedChart);
        return Promise.reject(
          new Error(
            'Invalid chart configuration. Must be valid JSON or a safe chart object literal.',
          ),
        );
      }
    }
  } else {
    // The chart is just a simple JSON object.
    chart = untrustedChart;
  }

  // Patch some bugs and issues.
  fixNodeVmObject(chart);

  chart.options = chart.options || {};

  if (chart.type === 'donut') {
    // Fix spelling...
    chart.type = 'doughnut';
  }

  // TODO(ian): Move special chart type out of this file.
  if (chart.type === 'sparkline') {
    if (chart.data.datasets.length < 1) {
      return Promise.reject(new Error('"sparkline" requres 1 dataset'));
    }
    chart.type = 'line';
    const dataseries = chart.data.datasets[0].data;
    if (!chart.data.labels) {
      chart.data.labels = Array(dataseries.length);
    }
    chart.options.legend = chart.options.legend || { display: false };
    if (!chart.options.elements) {
      chart.options.elements = {};
    }
    chart.options.elements.line = chart.options.elements.line || {
      borderColor: '#000',
      borderWidth: 1,
    };
    chart.options.elements.point = chart.options.elements.point || {
      radius: 0,
    };
    if (!chart.options.scales) {
      chart.options.scales = {};
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < dataseries.length; i += 1) {
      const dp = dataseries[i];
      min = Math.min(min, dp);
      max = Math.max(max, dp);
    }

    chart.options.scales.xAxes = chart.options.scales.xAxes || [{ display: false }];
    chart.options.scales.yAxes = chart.options.scales.yAxes || [
      {
        display: false,
        ticks: {
          // Offset the min and max slightly so that pixels aren't shaved off
          // under certain circumstances.
          min: min - min * 0.05,
          max: max + max * 0.05,
        },
      },
    ];
  }

  if (chart.type === 'progressBar') {
    chart.type = 'horizontalBar';

    if (chart.data.datasets.length < 1 || chart.data.datasets.length > 2) {
      throw new Error('progressBar chart requires 1 or 2 datasets');
    }

    let usePercentage = false;
    const dataLen = chart.data.datasets[0].data.length;
    if (chart.data.datasets.length === 1) {
      // Implicit denominator, always out of 100.
      usePercentage = true;
      chart.data.datasets.push({ data: Array(dataLen).fill(100) });
    }
    if (chart.data.datasets[0].data.length !== chart.data.datasets[1].data.length) {
      throw new Error('progressBar datasets must have the same size of data');
    }

    chart.data.labels = chart.labels || Array.from(Array(dataLen).keys());
    chart.data.datasets[1].backgroundColor = chart.data.datasets[1].backgroundColor || '#fff';
    // Set default border color to first Tableau color.
    chart.data.datasets[1].borderColor = chart.data.datasets[1].borderColor || '#4e78a7';
    chart.data.datasets[1].borderWidth = chart.data.datasets[1].borderWidth || 1;

    const deepmerge = require('deepmerge');
    chart.options = deepmerge(
      {
        legend: { display: false },
        scales: {
          xAxes: [
            {
              ticks: {
                display: false,
                beginAtZero: true,
              },
              gridLines: {
                display: false,
                drawTicks: false,
              },
            },
          ],
          yAxes: [
            {
              stacked: true,
              ticks: {
                display: false,
              },
              gridLines: {
                display: false,
                drawTicks: false,
                mirror: true,
              },
            },
          ],
        },
        plugins: {
          datalabels: {
            color: '#fff',
            formatter: (val, ctx) => {
              if (usePercentage) {
                return `${val}%`;
              }
              return val;
            },
            display: ctx => ctx.datasetIndex === 0,
          },
        },
      },
      chart.options,
    );
  }

  // Choose retina resolution by default. This will cause images to be 2x size
  // in absolute terms.
  chart.options.devicePixelRatio = devicePixelRatio || 2.0;

  // Implement other default options
  if (
    chart.type === 'bar' ||
    chart.type === 'horizontalBar' ||
    chart.type === 'line' ||
    chart.type === 'scatter' ||
    chart.type === 'bubble'
  ) {
    if (!chart.options.scales) {
      // TODO(ian): Merge default options with provided options
      chart.options.scales = {
        yAxes: [
          {
            ticks: {
              beginAtZero: true,
            },
          },
        ],
      };
    }
    addColorsPlugin(chart);
  } else if (chart.type === 'radar') {
    addColorsPlugin(chart);
  } else if (ROUND_CHART_TYPES.has(chart.type)) {
    addColorsPlugin(chart);
  } else if (chart.type === 'scatter') {
    addColorsPlugin(chart);
  } else if (chart.type === 'bubble') {
    addColorsPlugin(chart);
  }

  if (chart.type === 'line') {
    if (chart.data && chart.data.datasets && Array.isArray(chart.data.datasets)) {
      chart.data.datasets.forEach(dataset => {
        const data = dataset;
        // Make line charts straight lines by default.
        data.lineTension = data.lineTension || 0;
      });
    }
  }

  chart.options.plugins = chart.options.plugins || {};
  let usingDataLabelsDefaults = false;
  if (!chart.options.plugins.datalabels) {
    usingDataLabelsDefaults = true;
    chart.options.plugins.datalabels = {};
    if (chart.type === 'pie' || chart.type === 'doughnut') {
      chart.options.plugins.datalabels = {
        display: true,
      };
    } else {
      chart.options.plugins.datalabels = {
        display: false,
      };
    }
  }

  if (ROUND_CHART_TYPES.has(chart.type) || chart.type === 'radialGauge') {
    global.Chart = require('chart.js');
    // These requires have side effects.
    require('chartjs-plugin-piechart-outlabels');
    if (chart.type === 'doughnut' || chart.type === 'outlabeledDoughnut') {
      require('chartjs-plugin-doughnutlabel');
    }
    let userSpecifiedOutlabels = false;
    chart.data.datasets.forEach(dataset => {
      if (dataset.outlabels || chart.options.plugins.outlabels) {
        userSpecifiedOutlabels = true;
      } else {
        // Disable outlabels by default.
        dataset.outlabels = { display: false };
      }
    });

    if (userSpecifiedOutlabels && usingDataLabelsDefaults) {
      // If outlabels are enabled, disable datalabels by default.
      chart.options.plugins.datalabels = {
        display: false,
      };
    }
  }
  if (chart.options && chart.options.plugins && chart.options.plugins.colorschemes) {
    global.Chart = require('chart.js');
    require('chartjs-plugin-colorschemes');
  }
  logger.debug('Chart:', JSON.stringify(chart));

  if (version.startsWith('3') || version.startsWith('4')) {
    require('chartjs-adapter-moment');
  }
  if (!chart.plugins) {
    if (version.startsWith('3') || version.startsWith('4')) {
      chart.plugins = [];
    } else {
      const chartAnnotations = require('chartjs-plugin-annotation');
      const chartBoxViolinPlot = require('chartjs-chart-box-and-violin-plot');
      const chartDataLabels = require('chartjs-plugin-datalabels');
      const chartRadialGauge = require('chartjs-chart-radial-gauge');
      chart.plugins = [chartDataLabels, chartAnnotations];
      if (chart.type === 'radialGauge') {
        chart.plugins.push(chartRadialGauge);
      }
      if (BOXPLOT_CHART_TYPES.has(chart.type)) {
        chart.plugins.push(chartBoxViolinPlot);
      }
    }
  }

  // Background color plugin
  chart.plugins.push({
    id: 'background',
    beforeDraw: chartInstance => {
      if (backgroundColor) {
        // Chart.js v3 provides `chartInstance.chart` as `chartInstance`
        const chart = chartInstance.chart ? chartInstance.chart : chartInstance;
        const { ctx } = chart;
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, chart.width, chart.height);
      }
    },
  });

  // Pad below legend plugin
  if (chart.options.plugins.padBelowLegend) {
    chart.plugins.push({
      id: 'padBelowLegend',
      beforeInit: (chartInstance, val) => {
        global.Chart.Legend.prototype.afterFit = function afterFit() {
          this.height = this.height + (Number(val) || 0);
        };
      },
    });
  }

  const canvasRenderService = await getRenderer(width, height, version, format);

  if (format === 'svg') {
    // SVG rendering doesn't work asychronously.
    return Buffer.from(
      uniqueSvg(canvasRenderService.renderToBufferSync(chart, 'image/svg+xml').toString()),
    );
  }
  return canvasRenderService.renderToBuffer(chart);
}

module.exports = {
  renderChartJs,
};
