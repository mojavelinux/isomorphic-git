import path from 'path'
import pify from 'pify'
import { GitCommit, GitTree } from '../models'
import { GitObjectManager, GitIndexManager } from '../managers'
import { write, resolveRef, fs } from '../utils'

async function writeTreeToDisk ({ gitdir, workdir, index, prefix, tree }) {
  for (let entry of tree) {
    let { type, object } = await GitObjectManager.read({
      gitdir,
      oid: entry.oid
    })
    let entrypath = path.posix.join(prefix, entry.path)
    let filepath = path.join(workdir, prefix, entry.path)
    switch (type) {
      case 'blob':
        await write(filepath, object)
        let stats = await pify(fs().lstat)(filepath)
        index.insert({
          filepath: entrypath,
          stats,
          oid: entry.oid
        })
        break
      case 'tree':
        let tree = GitTree.from(object)
        await writeTreeToDisk({
          gitdir,
          workdir,
          index,
          prefix: entrypath,
          tree
        })
        break
      default:
        throw new Error(
          `Unexpected object type ${type} found in tree for '${entrypath}'`
        )
    }
  }
}

export async function checkout ({ workdir, gitdir, remote, ref }) {
  // Get tree oid
  let oid
  try {
    oid = await resolveRef({ gitdir, ref })
  } catch (e) {
    oid = await resolveRef({ gitdir, ref: `${remote}/${ref}` })
    await write(`${gitdir}/refs/heads/${ref}`, oid + '\n')
  }
  let commit = await GitObjectManager.read({ gitdir, oid })
  if (commit.type !== 'commit') {
    throw new Error(`Unexpected type: ${commit.type}`)
  }
  let comm = GitCommit.from(commit.object.toString('utf8'))
  let sha = comm.headers().tree
  // Get top-level tree
  let { type, object } = await GitObjectManager.read({ gitdir, oid: sha })
  if (type !== 'tree') throw new Error(`Unexpected type: ${type}`)
  let tree = GitTree.from(object)
  // Acquire a lock on the index
  await GitIndexManager.acquire(`${gitdir}/index`, async function (index) {
    index.clear()
    // Write files. TODO: Write them atomically
    await writeTreeToDisk({ gitdir, workdir, index, prefix: '', tree })
    // Update HEAD TODO: Handle non-branch cases
    write(`${gitdir}/HEAD`, `ref: refs/heads/${ref}`)
  })
}