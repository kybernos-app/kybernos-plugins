// Declarative charts: a slide carries <canvas data-chart='{"type":"bar","data":{...}}'> and this kit script draws it.
// The agent never writes script, so a slide stays inert HTML that can be sanitised, edited and exported.
(function () {
  function css (name) { return getComputedStyle(document.body).getPropertyValue(name).trim() }
  function draw () {
    if (!window.Chart) { window.__chartsReady = true; return }
    var fg = css('--fg'); var muted = css('--muted'); var accent = css('--accent'); var line = css('--line')
    window.Chart.defaults.color = fg
    window.Chart.defaults.font.family = css('--font')
    window.Chart.defaults.font.size = 22
    Array.prototype.forEach.call(document.querySelectorAll('canvas[data-chart]'), function (cv) {
      var cfg
      try { cfg = JSON.parse(cv.getAttribute('data-chart')) } catch (e) { return }
      cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, cfg.options || {})
      cfg.options.plugins = Object.assign({ legend: { display: false } }, cfg.options.plugins || {})
      cfg.options.scales = cfg.options.scales || { x: { grid: { display: false }, ticks: { color: muted } }, y: { grid: { color: line }, ticks: { color: muted } } }
      ;(cfg.data.datasets || []).forEach(function (d) { if (!d.backgroundColor) d.backgroundColor = accent; if (!d.borderColor && cfg.type === 'line') d.borderColor = accent })
      if (cv.__chart) cv.__chart.destroy()
      cv.__chart = new window.Chart(cv, cfg)
    })
    window.__chartsReady = true
  }
  window.__redrawCharts = draw
  if (document.readyState === 'complete') draw(); else window.addEventListener('load', draw)
})()
