/* eslint-env node, mocha */

const ColorThief = require('color-thief');
const assert = require('assert');
const imageSize = require('image-size');
const request = require('supertest');

const app = require('../../index');
const { BASIC_CHART, JS_CHART } = require('./chart_helpers');

const colorThief = new ColorThief();

function assertAlmostEqualNumbers(x, y, tolerance = 10) {
  const diff = Math.abs(x - y);
  const result = diff <= tolerance;
  if (!result) {
    throw new Error(`Got diff=${diff} (${x} vs ${y}) but expected <= ${tolerance}`);
  }
}

describe('chart request', () => {
  it('returns a basic chart via GET', done => {
    request(app)
      .get(`/chart?c=${encodeURIComponent(JSON.stringify(BASIC_CHART))}`)
      .expect('Content-Type', 'image/png')
      .expect(200)
      .end((err, res) => {
        const dimensions = imageSize(res.body);
        assert.equal(500 * 2, dimensions.width);
        assert.equal(300 * 2, dimensions.height);
        done();
      });
  });

  it('returns a basic chart via GET, base64 encoded', done => {
    request(app)
      .get(
        `/chart?c=${Buffer.from(JSON.stringify(BASIC_CHART)).toString('base64')}&encoding=base64`,
      )
      .expect('Content-Type', 'image/png')
      .expect(200)
      .end((err, res) => {
        const dimensions = imageSize(res.body);
        assert.equal(500 * 2, dimensions.width);
        assert.equal(300 * 2, dimensions.height);
        done();
      });
  });

  it('returns an JS chart via GET', done => {
    request(app)
      .get(`/chart?c=${encodeURIComponent(JS_CHART)}`)
      .expect('Content-Type', 'image/png')
      .expect(200)
      .end((err, res) => {
        const dimensions = imageSize(res.body);
        assert.equal(500 * 2, dimensions.width);
        assert.equal(300 * 2, dimensions.height);
        done();
      });
  });

  it('returns a basic chart via GET with parameters', done => {
    request(app)
      .get(
        `/chart?c=${encodeURIComponent(
          JSON.stringify(BASIC_CHART),
        )}&width=200&height=100&devicePixelRatio=1&backgroundColor=rgb(249, 193, 202)`,
      )
      .expect('Content-Type', 'image/png')
      .expect(200)
      .end((err, res) => {
        const rgb = colorThief.getColor(res.body);
        assertAlmostEqualNumbers(249, rgb[0]);
        assertAlmostEqualNumbers(193, rgb[1]);
        assertAlmostEqualNumbers(202, rgb[2]);

        const dimensions = imageSize(res.body);
        assert.equal(200, dimensions.width);
        assert.equal(100, dimensions.height);
        done();
      });
  });

  it('returns a basic chart via POST', done => {
    request(app)
      .post('/chart')
      .send({
        chart: BASIC_CHART,
      })
      .expect('Content-Type', 'image/png')
      .expect(200)
      .end((err, res) => {
        const dimensions = imageSize(res.body);
        assert.equal(500 * 2, dimensions.width);
        assert.equal(300 * 2, dimensions.height);
        done();
      });
  });

  it('returns a basic chart via POST, base64 encoded', done => {
    request(app)
      .post('/chart')
      .send({
        chart: Buffer.from(JSON.stringify(BASIC_CHART)).toString('base64'),
        encoding: 'base64',
      })
      .expect('Content-Type', 'image/png')
      .expect(200)
      .end((err, res) => {
        const dimensions = imageSize(res.body);
        assert.equal(500 * 2, dimensions.width);
        assert.equal(300 * 2, dimensions.height);
        done();
      });
  });

  it('returns an advanced chart via POST', done => {
    request(app)
      .post('/chart')
      .send({
        chart: JS_CHART,
      })
      .expect('Content-Type', 'image/png')
      .expect(200)
      .end((err, res) => {
        const dimensions = imageSize(res.body);
        assert.equal(500 * 2, dimensions.width);
        assert.equal(300 * 2, dimensions.height);
        done();
      });
  });

  it('returns an advanced chart via POST with parameters', done => {
    request(app)
      .post('/chart')
      .send({
        chart: JS_CHART,
        width: 456,
        height: 123,
        devicePixelRatio: 1.0,
        backgroundColor: 'rgb(90, 80, 70)',
      })
      .expect('Content-Type', 'image/png')
      .expect(200)
      .end((err, res) => {
        const rgb = colorThief.getColor(res.body);
        assertAlmostEqualNumbers(90, rgb[0]);
        assertAlmostEqualNumbers(80, rgb[1]);
        assertAlmostEqualNumbers(70, rgb[2]);

        const dimensions = imageSize(res.body);
        assert.equal(456, dimensions.width);
        assert.equal(123, dimensions.height);
        done();
      });
  });

  it('returns an advanced chart via POST with parameters and base 64', done => {
    request(app)
      .post('/chart')
      .send({
        chart: Buffer.from(JS_CHART).toString('base64'),
        width: 369,
        height: 150,
        devicePixelRatio: 1.0,
        backgroundColor: 'rgb(190, 180, 170)',
        encoding: 'base64',
      })
      .expect('Content-Type', 'image/png')
      .expect(200)
      .end((err, res) => {
        const rgb = colorThief.getColor(res.body);
        assertAlmostEqualNumbers(190, rgb[0]);
        assertAlmostEqualNumbers(180, rgb[1]);
        assertAlmostEqualNumbers(170, rgb[2]);

        const dimensions = imageSize(res.body);
        assert.equal(369, dimensions.width);
        assert.equal(150, dimensions.height);
        done();
      });
  });

  it('reverts correctly to background transparency', done => {
    // Don't let background selection stick between requests.
    request(app)
      .post('/chart')
      .send({
        chart: BASIC_CHART,
      })
      .expect('Content-Type', 'image/png')
      .expect(200)
      .end((err, res) => {
        const rgb = colorThief.getColor(res.body);
        // Image is transparent by default - expect dominant color to be blue
        // bars.
        assertAlmostEqualNumbers(52, rgb[0]);
        assertAlmostEqualNumbers(164, rgb[1]);
        assertAlmostEqualNumbers(236, rgb[2]);

        const dimensions = imageSize(res.body);
        assert.equal(500 * 2, dimensions.width);
        assert.equal(300 * 2, dimensions.height);
        done();
      });
  });
});
