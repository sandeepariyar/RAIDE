import axe from 'axe-core';
setTimeout(async () => {
  const result = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  });
  const summary = {
    violations: result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
    passes: result.passes.length,
    incomplete: result.incomplete.length,
  };
  console.log('RAIDE_AUDIT ' + JSON.stringify(summary));
  const resultBox = document.createElement('pre');
  resultBox.id = 'audit-result';
  resultBox.textContent = JSON.stringify(summary, null, 2);
  document.body.append(resultBox);
}, 8000);
