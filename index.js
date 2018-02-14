const fs = require('fs')
const util = require('util')
const path = require('path')
const nunjucks = require('nunjucks')

const dateformat = require('dateformat')

const capitalize = str => str[0].toUpperCase() + str.slice(1)

const argv = require('yargs')
  .usage('Usage: $0 -s [source]')
  .example('$0 -s model.json')
  .example('$0 -s model.json -a Me -p MyProject -c MyCompany')
  .example('$0 -s model.json --use-struct --namespace My')
  .demand('s')
  .alias('s', 'source')
  .describe('s', 'Source file or dir')
  .alias('o', 'output-dir')
  .describe('o', 'Output dir')
  .alias('t', 'template')
  .describe('t', 'Specify template file')
  .boolean('use-struct')
  .describe('use-struct', 'Use `struct` (default is `class`)')
  .boolean('enable-extends')
  .describe('enable-extends', 'Enable parsing of `extends` key in json schema')
  .boolean('deep-types')
  .describe('deep-types', 'Read `$ref` file paths for `type` searching')
  .array('inherits')
  .describe('inherits', 'Specify inheritances')
  .array('protocols')
  .describe('protocols', 'Specify protocols')
  .boolean('has-header')
  .describe('has-header', 'Add header')
  .alias('p', 'project')
  .describe('p', 'Specify project name for header')
  .alias('a', 'author')
  .describe('a', 'Specify author name for header')
  .alias('c', 'company')
  .describe('c', 'Specify company name for header')
  .alias('n', 'namespace')
  .describe('n', 'Specify a namespace prefix')
  .count('verbose')
  .alias('v', 'verbose')
  .describe('v', 'Specify verbosity level (eg. -vv = Level 2)')
  .help('h')
  .alias('h', 'help')
  .epilog('copyright - akabab 2016')
  .argv

const VERBOSE_LEVEL = argv.verbose || 0

const WARN = () => { VERBOSE_LEVEL >= 0 && console.log.apply(console, arguments) }
const INFO = () => { VERBOSE_LEVEL >= 1 && console.log.apply(console, arguments) }
const DEBUG = () => { VERBOSE_LEVEL >= 2 && console.log.apply(console, arguments) }

const namespace = argv.namespace || ''

const templatesDirPath = argv.t ? path.parse(argv.t).dir : __dirname + '/templates/'
nunjucks.configure(templatesDirPath, { autoescape: false })

const defaultTemplateFile = 'template.nunjucks'
const templateFile = argv.t ? path.parse(argv.t).base : defaultTemplateFile

if (!argv.s) return WARN('Missing source parameter')

const lstat = util.promisify(fs.lstat)
const readdir = util.promisify(fs.readdir)
const readFile = util.promisify(fs.readFile)
const writeFile = util.promisify(fs.writeFile)
const mkdirp = util.promisify(fs.mkdir)

const getFileInfos = async filePath => {
  const absolutePath = path.resolve(filePath)
  const stats = await lstat(filePath)

  return {
    ...path.parse(absolutePath),
    absolutePath,
    relativePath: filePath,
    isDirectory: stats.isDirectory()
  }
}

const getFiles = async dir => (await readdir(dir)).map(file => path.join(dir, file))

const jstsm = async src => {
  const stats = await lstat(src)
  const filenames = stats.isDirectory() ? await getFiles(src) : [ src ]

  const files = await Promise.all(filenames.map(getFileInfos))
  const jsonfiles = files.filter(file => !file.isDirectory && file.ext === '.json')

  // content
  const validfiles = await Promise.all(jsonfiles.map(async file => {
    file.content = await readFile(file.absolutePath, 'utf8').then(JSON.parse)
    return file
  }))

  return validfiles
}

const getHeader = ({ project, author, company }) => {
  const now = new Date()

  return {
    projectName: project || '<PROJECT>',
    author: author || '<AUTHOR>',
    now: dateformat(now, 'dd/mm/yy'),
    copyright: `${now.getFullYear()} ${(company || '<COMPANY>')}`,
  }
}

const parsePropsFromJson = json => Object.keys(json.properties)
  .map(key => {
    const prop = json.properties[key]
    const type = getType(prop)

    return {
      key: key,
      isArr: type.isArr,
      isRef: type.isRef,
      type: type.typeStr,
      required: prop.required || json.required.includes(key)
    }
  })

const analyzeFile = file => {
  const json = file.content

  if (json.type !== 'object') { return WARN(path, 'is not of type object', 'SKIPPED') }

  if (!json.properties || typeof json.properties !== 'object') { return WARN(path, 'missing properties', 'SKIPPED') }

  // Extends handling
  const superClass = argv['enable-extends'] && json.extends && getType(json.extends).typeStr

  const extendArray = prepareExtends(superClass)

  // Render

  const props = {
    modelName: namespace + capitalize(file.name),
    header: argv['has-header'] && getHeader(argv),
    isStruct: argv['use-struct'],
    extends: (extendArray && extendArray.length > 0) ? extendArray : false,
    hasSuperClass: !!superClass,
    properties: parsePropsFromJson(json),
  }

  const output = nunjucks.render(templateFile, props)

  // Write

  const outputDir = argv.o || './output'
  const destPath = `${outputDir}/${props.modelName}.swift`

  const noop = _ => _
  mkdirp(outputDir).catch(noop)
    .then(() => writeFile(destPath, output)
      .then(() => console.log(`${destPath} success`), console.error))
}

// HELPERS

const BASIC_TYPES = {
  'string': 'String',
  'integer': 'Int',
  'number': 'Double',
  'boolean': 'Bool',
  'any': 'Any',
}

const getType = obj => {

  if (typeof obj !== 'object') { return }

  if (obj.hasOwnProperty('$ref')) {
    // if (argv['deep-types']) {
    //   const t = typeForFilePath(src.dir + '/' + obj.$ref) // getFile -> getType(file.content)

    //   return {
    //     isArr: false,
    //     isRef: t.typeStr === 'Object',
    //     typeStr: t.typeStr === 'Object' ? namespace + capitalize(path.parse(obj.$ref).name) : t.typeStr
    //   }
    // }

    return {
      isArr: false,
      isRef: true,
      typeStr: namespace + capitalize(path.parse(obj.$ref).name)
    }
  }

  if (obj.hasOwnProperty('type')) {
    switch (typeof obj.type) {
      case 'string':
        switch (obj.type) {
          case 'object':
            return {
              isArr: false,
              isRef: false,
              typeStr: 'Object'
            }

            case 'array':
              const itemsTypeObject = getType(obj.items)

              return {
                isArr: true,
                isRef: !!itemsTypeObject && itemsTypeObject.isRef,
                typeStr: itemsTypeObject ? itemsTypeObject.typeStr : 'AnyObject'
              }

            case 'string':
            case 'integer':
            case 'number':
            case 'boolean':
            case 'any':
              return {
                isArr: false,
                isRef: false,
                typeStr: BASIC_TYPES[obj.type]
              }

            default:
              DEBUG('type not handled:', obj.type)
              break
          }
      default:
        // cf. https://spacetelescope.github.io/understanding-json-schema/reference/type.html
        DEBUG('typeof not handled:', typeof obj.type)
        break
    }
  }

}

const prepareExtends = (superClass) => {
  let extendArray = []

  if (superClass) {
    extendArray.push(superClass)
  }

  const isStruct = argv['use-struct']

  const inherits = argv.inherits
  if (inherits && inherits.length) {
    if (isStruct) return WARN('inheritance ignored with struct')

    extendArray = inherits
  }

  const protocols = argv.protocols
  if (!superClass && protocols && protocols.length) {
    extendArray = extendArray.concat(protocols)
  }

  return extendArray
}

jstsm(argv.s).then(files => files.forEach(analyzeFile))
  .catch(err => console.error('catched', err))
