// マニュアル撮影の影響フラグを解決・検証するCLI。
// Playwrightには依存せず、CIからも実行できるようNode標準APIだけで動かす。
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const MAP_PATH = path.join(HERE, 'impact-map.json')
const CHANGES_DIR = path.join(HERE, 'changes')

const exists = async (file) => {
  try { await fs.access(file); return true } catch (_) { return false }
}
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'))
const normalizePath = (value) => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '')
const unique = (values) => [...new Set(values)]

export function recipeStepId(task, step, index) {
  return step.id || step.shot || `${task.id}-${String(index + 1).padStart(2, '0')}`
}

function globRegExp(pattern) {
  const normalized = normalizePath(pattern)
  let out = ''
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '*' && normalized[i + 1] === '*') { out += '.*'; i++; continue }
    if (ch === '*') { out += '[^/]*'; continue }
    if (ch === '?') { out += '[^/]'; continue }
    out += /[.+^${}()|[\]\\]/.test(ch) ? '\\' + ch : ch
  }
  return new RegExp(`^${out}$`)
}

function sourceMatches(source, changedFile, diff = null) {
  const pattern = typeof source === 'string' ? source : source?.path
  if (!pattern || !globRegExp(pattern).test(normalizePath(changedFile))) return false
  const anchors = typeof source === 'string' ? [] : (source.anchors || [])
  return diff === null || !anchors.length || anchors.some((anchor) => diff.includes(anchor))
}

export async function loadImpactConfig() {
  const map = await readJson(MAP_PATH)
  const recipes = {}
  for (const audience of Object.keys(map.audiences || {})) {
    recipes[audience] = await readJson(path.join(HERE, map.audiences[audience].recipe))
  }
  return { map, recipes }
}

export function flagIndex(map) {
  return new Map((map.flags || []).map((flag) => [flag.id, flag]))
}

export async function resolveChangeTargets(change, config = null) {
  config ||= await loadImpactConfig()
  const { map, recipes } = config
  const flags = flagIndex(map)
  const selected = unique(change.flags || [])
  if (!selected.length) throw new Error('change record に flags がありません')
  const audiences = {}
  for (const flagId of selected) {
    const flag = flags.get(flagId)
    if (!flag) throw new Error(`impact-map.json に未登録のフラグです: ${flagId}`)
    for (const target of flag.targets || []) {
      const recipe = recipes[target.audience]
      if (!recipe) throw new Error(`対象者のレシピがありません: ${target.audience}`)
      const task = recipe.tasks.find((item) => item.id === target.task)
      if (!task) throw new Error(`レシピにタスクがありません: ${target.audience}/${target.task}`)
      const audience = audiences[target.audience] ||= { sourceRepo: map.audiences[target.audience].sourceRepo, tasks: {} }
      const taskTarget = audience.tasks[target.task] ||= { all: false, steps: [] }
      if (target.step) taskTarget.steps.push(target.step)
      else taskTarget.all = true
    }
  }
  for (const audience of Object.values(audiences)) {
    for (const target of Object.values(audience.tasks)) target.steps = unique(target.steps)
  }
  if (change.mode === 'new-task') {
    for (const [audience, target] of Object.entries(audiences)) {
      for (const [task, steps] of Object.entries(target.tasks)) {
        if (!steps.all) throw new Error(`new-task は全ステップ対象にしてください: ${audience}/${task}`)
      }
    }
  }
  return { flags: selected, audiences }
}

export async function resolveChangePath(value) {
  const candidate = value || ''
  const direct = path.isAbsolute(candidate) ? candidate : path.resolve(HERE, candidate)
  if (await exists(direct)) return direct
  const named = path.join(CHANGES_DIR, candidate.endsWith('.json') ? candidate : `${candidate}.json`)
  if (await exists(named)) return named
  throw new Error(`change record が見つかりません: ${candidate}`)
}

export async function loadChangeRecord(value) {
  const file = await resolveChangePath(value)
  const change = await readJson(file)
  if (!change.id) throw new Error(`change record に id がありません: ${file}`)
  if (!['diff-capture', 'new-task', 'text-only'].includes(change.mode)) {
    throw new Error(`change record の mode が不正です: ${change.mode}`)
  }
  return { file, change }
}

function recipeTargets(config) {
  const out = []
  for (const [audience, recipe] of Object.entries(config.recipes)) {
    for (const task of recipe.tasks || []) {
      for (const [index, step] of task.steps.entries()) {
        out.push({ audience, task: task.id, step: recipeStepId(task, step, index), shot: step.shot || null })
      }
    }
  }
  return out
}

function validateTargets(config, errors) {
  const { map, recipes } = config
  const flags = flagIndex(map)
  if (map.version !== 1) errors.push('impact-map.json の version は 1 にしてください')
  if (!Array.isArray(map.flags) || !map.flags.length) errors.push('impact-map.json の flags が空です')
  if (flags.size !== (map.flags || []).length) errors.push('影響フラグIDが重複しています')
  for (const flag of map.flags || []) {
    if (!flag.id || !flag.label) errors.push('影響フラグに id または label がありません')
    if (typeof flag.requiresManual !== 'boolean') errors.push(`${flag.id}: requiresManual はbooleanにしてください`)
    if (!Array.isArray(flag.sources) || !flag.sources.length) errors.push(`${flag.id}: sources がありません`)
    if (!Array.isArray(flag.targets) || !flag.targets.length) errors.push(`${flag.id}: targets がありません`)
    for (const target of flag.targets || []) {
      const recipe = recipes[target.audience]
      const task = recipe?.tasks?.find((item) => item.id === target.task)
      const step = task?.steps?.find((item, index) => recipeStepId(task, item, index) === target.step)
      if (!recipe) errors.push(`${flag.id}: audience がありません: ${target.audience}`)
      else if (!task) errors.push(`${flag.id}: task がありません: ${target.audience}/${target.task}`)
      else if (target.step && !step) errors.push(`${flag.id}: step がありません: ${target.audience}/${target.task}/${target.step}`)
    }
  }
  for (const [audience, recipe] of Object.entries(recipes)) {
    const taskIds = new Set()
    for (const task of recipe.tasks || []) {
      if (taskIds.has(task.id)) errors.push(`${audience}: task IDが重複しています: ${task.id}`)
      taskIds.add(task.id)
      for (const impact of task.impact || []) if (!flags.has(impact)) errors.push(`${audience}/${task.id}: 未登録のimpact: ${impact}`)
      for (const impact of task.impact || []) {
        const flag = flags.get(impact)
        if (flag && !(flag.targets || []).some((target) => target.audience === audience && target.task === task.id && !target.step)) {
          errors.push(`${audience}/${task.id}: task impactのtargetsがimpact-mapと一致しません: ${impact}`)
        }
      }
      const stepIds = new Set()
      for (const [index, step] of (task.steps || []).entries()) {
        const id = recipeStepId(task, step, index)
        if (!stepIds.add(id)) errors.push(`${audience}/${task.id}: step IDが重複しています: ${id}`)
        for (const impact of step.impact || []) if (!flags.has(impact)) errors.push(`${audience}/${task.id}/${id}: 未登録のimpact: ${impact}`)
        for (const impact of step.impact || []) {
          const flag = flags.get(impact)
          if (flag && !(flag.targets || []).some((target) => target.audience === audience && target.task === task.id && target.step === id)) {
            errors.push(`${audience}/${task.id}/${id}: step impactのtargetsがimpact-mapと一致しません: ${impact}`)
          }
        }
      }
    }
  }
  return { flags, targetList: recipeTargets(config) }
}

async function validateGenerated(config, errors) {
  const { map, recipes } = config
  for (const [audience, recipe] of Object.entries(recipes)) {
    const contentPath = path.join(ROOT, 'content', `${audience}.json`)
    if (!await exists(contentPath)) { errors.push(`生成contentがありません: ${contentPath}`); continue }
    const content = await readJson(contentPath)
    const contentTasks = new Map((content.tasks || []).map((task) => [task.id, task]))
    for (const task of recipe.tasks || []) {
      const generated = contentTasks.get(task.id)
      if (!generated) { errors.push(`${audience}: 生成contentにタスクがありません: ${task.id}`); continue }
      const generatedSteps = generated.steps || []
      if (generatedSteps.length !== task.steps.length) {
        errors.push(`${audience}/${task.id}: 生成contentのステップ数がレシピと一致しません`)
      }
      for (const [index, recipeStep] of task.steps.entries()) {
        const step = generatedSteps[index]
        if (!step) continue
        const expectedId = recipeStepId(task, recipeStep, index)
        if (step.id && step.id !== expectedId) errors.push(`${audience}/${task.id}: step IDが不一致です: ${step.id} (expected ${expectedId})`)
        const expectedShot = recipeStep.shot || null
        const actualShot = step.shot ? path.basename(step.shot, '.webp') : null
        if (expectedShot !== actualShot) errors.push(`${audience}/${task.id}/${expectedId}: shotがレシピと不一致です`)
        if (step.shot) {
          const shotPath = path.join(ROOT, step.shot)
          if (!await exists(shotPath)) errors.push(`${audience}/${task.id}: 画像がありません: ${step.shot}`)
        }
      }
    }
    for (const task of content.tasks || []) if (!recipe.tasks.some((item) => item.id === task.id)) errors.push(`${audience}: レシピにない生成タスクです: ${task.id}`)
  }
  // ローカルでは兄弟リポジトリのソースファイルも確認する。公開manual CIでは存在しないため省略する。
  const reposRoot = path.resolve(ROOT, '..')
  if (await exists(path.join(reposRoot, 'admin')) || await exists(path.join(reposRoot, 'shift-form'))) {
    for (const flag of map.flags || []) {
      const repo = map.audiences[flag.targets?.[0]?.audience]?.sourceRepo
      const sourceRoot = repo && path.join(reposRoot, repo)
      if (!sourceRoot || !await exists(sourceRoot)) continue
      for (const source of flag.sources || []) {
        const pattern = typeof source === 'string' ? source : source.path
        if (pattern.includes('*')) continue
        if (!await exists(path.join(sourceRoot, pattern))) errors.push(`${flag.id}: sourceがありません: ${repo}/${pattern}`)
      }
    }
  }
}

async function validateChanges(config, errors) {
  if (!await exists(CHANGES_DIR)) return
  const { map } = config
  const flags = flagIndex(map)
  for (const name of await fs.readdir(CHANGES_DIR)) {
    if (!name.endsWith('.json')) continue
    const file = path.join(CHANGES_DIR, name)
    let change
    try { change = await readJson(file) } catch (error) { errors.push(`${name}: JSONを読めません: ${error.message}`); continue }
    if (!change.id || name !== `${change.id}.json`) errors.push(`${name}: ファイル名はid.jsonにしてください`)
    if (!['diff-capture', 'new-task', 'text-only'].includes(change.mode)) errors.push(`${name}: modeが不正です`)
    if (!['planned', 'captured', 'verified'].includes(change.status)) errors.push(`${name}: statusが不正です`)
    for (const flag of change.flags || []) if (!flags.has(flag)) errors.push(`${name}: 未登録のflag: ${flag}`)
    const audience = Object.values(map.audiences || {}).find((item) => item.sourceRepo === change.sourceRepo)
    if (!audience) errors.push(`${name}: sourceRepoがimpact-mapにありません: ${change.sourceRepo}`)
    try { await resolveChangeTargets(change, config) } catch (error) { errors.push(`${name}: target解決に失敗しました: ${error.message}`) }
  }
}

export async function validateAll() {
  const config = await loadImpactConfig()
  const errors = []
  validateTargets(config, errors)
  await validateGenerated(config, errors)
  await validateChanges(config, errors)
  if (errors.length) throw new Error(`manual-impact validate failed:\n- ${errors.join('\n- ')}`)
  return config
}

function changedFilesFromArgs(options) {
  const values = []
  if (options.files) values.push(...options.files.split(/[,\r\n]+/).map(normalizePath).filter(Boolean))
  if (options.fileList) values.push(...options.fileList.split(/\r?\n/).map(normalizePath).filter(Boolean))
  return unique(values)
}

function candidateFlags(map, files, diff = null) {
  return (map.flags || []).filter((flag) => (flag.sources || []).some((source) => files.some((file) => sourceMatches(source, file, diff))))
}

function parseMarker(body) {
  const match = String(body || '').match(/<!--\s*pwgws-manual-change\s*([\s\S]*?)-->/i)
  if (!match) return null
  try { return JSON.parse(match[1].trim()) } catch (error) { throw new Error(`PR本文のpwgw-manual-change JSONが不正です: ${error.message}`) }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function assetVersions(diff, asset, prefix) {
  const basename = escapeRegExp(path.posix.basename(asset))
  const pattern = new RegExp(`${basename}\\?v=(\\d+)`, 'g')
  return [...diff.split(/\r?\n/)
    .filter((line) => line.startsWith(prefix) && !line.startsWith(prefix + prefix))
    .join('\n').matchAll(pattern)].map((match) => Number(match[1]))
}

function versionBumpErrors(diff, assets) {
  const errors = []
  for (const asset of assets) {
    const oldVersions = assetVersions(diff, asset, '-')
    const newVersions = assetVersions(diff, asset, '+')
    const increased = newVersions.some((version) => version > Math.max(...oldVersions, -1))
    if (!oldVersions.length || !newVersions.length || !increased) {
      errors.push(`${asset}: 変更されたHTML参照の ?v= が確認できません（旧=${oldVersions.join(',') || 'なし'} / 新=${newVersions.join(',') || 'なし'}）`)
    }
  }
  return errors
}

function flagCovers(candidate, selectedIds, flags) {
  return (candidate.targets || []).every((target) => [...selectedIds].some((selectedId) => {
    const selected = flags.get(selectedId)
    return (selected?.targets || []).some((covered) => (
      covered.audience === target.audience &&
      covered.task === target.task &&
      (!covered.step || covered.step === target.step)
    ))
  }))
}

export async function checkChanges(options = {}) {
  const config = await loadImpactConfig()
  const files = changedFilesFromArgs(options)
  const diff = options.diff ?? null
  const uiFiles = files.filter((file) => /(?:^|\/)(?:[^/]+\.(?:html|css|js))$/i.test(file))
  if (!uiFiles.length) return { files, candidates: [], skipped: true }
  const candidates = candidateFlags(config.map, uiFiles, diff).filter((flag) => flag.requiresManual)
  if (!candidates.length) throw new Error(`UI変更に対応するimpact flagがありません:\n- ${uiFiles.join('\n- ')}`)
  const marker = parseMarker(options.prBody || '')
  if (!marker?.id) throw new Error('UI変更にはPR本文の pwgws-manual-change マーカーが必要です')
  const { file, change } = await loadChangeRecord(marker.id)
  if (change.sourceRepo !== options.repo) throw new Error(`change recordのsourceRepoが不一致です: ${change.sourceRepo} (expected ${options.repo})`)
  if (change.status !== 'verified') throw new Error(`マニュアル確認前です: ${file} の status を verified にしてください`)
  if (marker.sourceRepo !== change.sourceRepo) throw new Error('PR本文マーカーのsourceRepoがchange recordと不一致です')
  if (marker.mode !== change.mode) throw new Error('PR本文マーカーのmodeがchange recordと不一致です')
  if (!Array.isArray(marker.flags) || unique(marker.flags).sort().join(',') !== unique(change.flags || []).sort().join(',')) {
    throw new Error('PR本文マーカーのflagsがchange recordと不一致です')
  }
  const resolved = await resolveChangeTargets(change, config)
  const flags = flagIndex(config.map)
  const uncovered = candidates.filter((candidate) => !flagCovers(candidate, new Set(change.flags || []), flags))
  if (uncovered.length) {
    throw new Error(`変更ファイルに対応する影響範囲がchange recordで不足しています:\n不足: ${uncovered.map((flag) => flag.id).join(', ')}\n記録: ${(change.flags || []).join(', ')}`)
  }
  const versionFiles = uiFiles.filter((file) => /\.(?:js|css)$/i.test(file))
  const htmlFiles = uiFiles.filter((file) => /\.html$/i.test(file))
  if (versionFiles.length && !htmlFiles.length) {
    throw new Error('JS/CSS変更には、参照HTMLの ?v= 更新を含むHTML変更も必要です')
  }
  if (versionFiles.length && diff !== null) {
    const versionErrors = versionBumpErrors(diff, versionFiles)
    if (versionErrors.length) throw new Error(`JS/CSS変更の ?v= 更新を確認できません:\n- ${versionErrors.join('\n- ')}`)
  }
  return { files, candidates: candidates.map((flag) => flag.id), marker, change, resolved }
}

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv
  const options = { command }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--json') options.json = true
    else if (arg === '--repo') options.repo = rest[++i]
    else if (arg === '--change') options.change = rest[++i]
    else if (arg === '--files') options.files = rest[++i]
    else if (arg === '--file-list') options.fileList = rest[++i]
    else if (arg === '--diff-file') options.diffFile = rest[++i]
    else if (arg === '--pr-body') options.prBody = rest[++i]
    else if (arg === '--pr-body-file') options.prBody = undefined, options.prBodyFile = rest[++i]
    else if (arg.startsWith('--')) throw new Error(`未知のオプション: ${arg}`)
    else options.value = arg
  }
  return options
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.prBodyFile) options.prBody = await fs.readFile(options.prBodyFile, 'utf8')
  if (options.diffFile) options.diff = await fs.readFile(options.diffFile, 'utf8')
  if (options.command === 'validate') {
    await validateAll()
    console.log('manual-impact validate: OK')
    return
  }
  const config = await loadImpactConfig()
  if (options.command === 'suggest' || options.command === 'list') {
    const files = changedFilesFromArgs(options)
    const flags = candidateFlags(config.map, files)
    if (options.json) console.log(JSON.stringify({ files, flags: flags.map((flag) => flag.id) }, null, 2))
    else console.log(flags.length ? flags.map((flag) => `${flag.id}\t${flag.label}`).join('\n') : '候補のimpact flagはありません')
    return
  }
  if (options.command === 'targets') {
    if (!options.change) throw new Error('targets には --change が必要です')
    const { file, change } = await loadChangeRecord(options.change)
    const resolved = await resolveChangeTargets(change, config)
    if (options.json) console.log(JSON.stringify({ file, change, resolved }, null, 2))
    else {
      console.log(`${change.id} (${change.mode}, ${change.status})`)
      for (const [audience, target] of Object.entries(resolved.audiences)) {
        for (const [task, steps] of Object.entries(target.tasks)) console.log(`- ${audience}/${task}: ${steps.all ? '全ステップ' : steps.steps.join(', ')}`)
      }
    }
    return
  }
  if (options.command === 'check') {
    const result = await checkChanges({ ...options, prBody: options.prBody || '' })
    console.log(result.skipped ? 'manual-impact check: UI変更なし' : `manual-impact check: OK (${result.change.id})`)
    return
  }
  throw new Error('使い方: node manual-impact.mjs validate | suggest --files file1,file2 | targets --change id | check --repo repo --files ... --pr-body-file file --diff-file diff')
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
