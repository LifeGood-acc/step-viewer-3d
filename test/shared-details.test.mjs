// Tests for the details text (editor/shared/details.js). Same file in both plugins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { detailsText } from '../editor/shared/details.js'

test('the details become aligned plain text', () => {
  const t = detailsText('3D Model Viewer details', [['File size', '53.8 KB'], ['Triangles', '1,832'], ['Unit', 'meters']])
  assert.equal(t, '3D Model Viewer details\nFile size  53.8 KB\nTriangles  1,832\nUnit       meters\n')
  assert.equal(detailsText('x', []), 'x\n')
})
