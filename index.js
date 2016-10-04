require('./utils.js')

var dir = require('node-dir')
var mkdirp = require('mkdirp')

var _ = require('lodash')
var parsePath = require('parse-filepath')

var nunjucks = require('nunjucks')
nunjucks.configure({ autoescape: false })

var fs = require('fs')

// var jsonschema = require('jsonschema')
// var draft4schema = JSON.parse(fs.readFileSync("./draft_schemas/draft-04/schema.json", 'utf8'))
// console.log("draft4schema:", draft4schema)
// var v = jsonschema.validate(json, draft4schema)
// var v = jsonschema.validate({"one": 1}, draft4schema)
// console.log("v:", v)

var dateformat = require('dateformat')

var argv = require('yargs')
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

VERBOSE_LEVEL = argv.verbose

function WARN()  { VERBOSE_LEVEL >= 0 && console.log.apply(console, arguments) }
function INFO()  { VERBOSE_LEVEL >= 1 && console.log.apply(console, arguments) }
function DEBUG() { VERBOSE_LEVEL >= 2 && console.log.apply(console, arguments) }

var namespace = argv.namespace || ""

// START

if (!argv.s) {
    WARN("Missing source parameter")
    return
}

try {
    fs.accessSync(argv.s)
    var stat = fs.lstatSync(argv.s)

    var src = {
        path: argv.s,
        isDirectory: stat.isDirectory(),
        dir: stat.isDirectory() ? argv.s : parsePath(argv.s).dir
    }

    if (stat.isDirectory()) {
        dir.readFiles(src.path, {
            match: /.json$/,
        }, function (err, fileContent, filePath, next) {
            if (err) throw err

            parseFile(filePath, fileContent)
            next()
        },
        function (err, files){
            if (err) throw err
        })
    }
    else if (stat.isFile()) {
        var fileContent = fs.readFileSync(src.path, 'utf8')

        parseFile(src.path, fileContent)
    }

} catch (e) {
    return WARN(e.message)
}


// METHODS

function parseFile(filePath, fileContent) {
    INFO("> Parsing", filePath)
    var fileName = parsePath(filePath).name

    try {
        var json = JSON.parse(fileContent)
    } catch (e) {
        return WARN("Parsing error:", e)
    }

    // TODO: Validate


    // Prepare
    if (json.type !== "object") {
        WARN(filePath, "is not of type 'object'", "SKIPPED")
        return
    }

    if (!json.properties || typeof json.properties !== "object") {
        WARN(filePath, "missing properties", "SKIPPED")
        return
    }

    var properties = Object.keys(json.properties).map(key => {
        var p = json.properties[key]

        var typeObject = typeForObject(p)

        var o = {
            key: key,
            isArr: typeObject.isArr,
            isRef: typeObject.isRef,
            type: typeObject.typeStr,
            required: p.required == true || json.required.contains(key)
        }

        return o
    })


    // Extends handling

    var handleExtends = argv['enable-extends']

    if (handleExtends) {
        var superClass = json.extends && typeForObject(json.extends).typeStr
    }

    var extendArray = prepareExtends(superClass)


    // Header

    if (argv['has-header']) {
        var now = new Date()
        var header = {
            projectName: argv.project || "<PROJECT_NAME>",
            author: argv.author || "<AUTHOR>",
            now: dateformat(now, "dd/mm/yy"),
            copyright: now.getFullYear() + " " + (argv.company || "<COMPANY>"), // eg. Copyright © 2016 OpenJet
        }
    }


    // Render

    var modelName = namespace + _.upperFirst(fileName)

    var templateFilePath = __dirname + '/templates/template.nunjucks'
    var output = nunjucks.render(templateFilePath, {
        modelName: modelName,
        header: header,
        isStruct: argv['use-struct'],
        extends: (extendArray && extendArray.length > 0) ? extendArray : false,
        hasSuperClass: !!superClass,
        properties: properties
    })


    // Write

    var outputDir = argv.o || './output'
    mkdirp(outputDir)

    var destFilePath = outputDir + "/" + modelName + ".swift"

    fs.writeFile(destFilePath, output, function (err) {
        if (err) { return WARN(err) }

        INFO("File saved to:", destFilePath)
    })

}

// HELPERS

function typeForFilePath(filePath) {

    var fileContent = fs.readFileSync(filePath, 'utf8')

    try {
        var json = JSON.parse(fileContent)
    } catch (e) {
        WARN("Parsing error:", e)
        return
    }

    if (typeof json !== "object") {
        WARN(filePath, "not an object")
        return
    }

    return typeForObject(json)
}

function typeForObject(obj) {

    var BASIC_TYPES = {
        "string": "String",
        "integer": "Int",
        "number": "Double",
        "boolean": "Bool",
        "any": "Any",
    }

    if (typeof obj !== "object") { return }

    if (obj.hasOwnProperty("$ref")) {

        if (argv['deep-types']) {
            var t = typeForFilePath(src.dir + "/" + obj.$ref)

            return {
                isArr: false,
                isRef: t.typeStr === "Object",
                typeStr: t.typeStr === "Object" ? namespace + _.upperFirst(parsePath(obj.$ref).name) : t.typeStr
            }
        }

        return {
            isArr: false,
            isRef: true,
            typeStr: namespace + _.upperFirst(parsePath(obj.$ref).name)
        }
    }

    if (obj.hasOwnProperty("type")) {
        switch (typeof obj.type) {
            case "string":
                switch (obj.type) {
                    case "object":
                        return {
                            isArr: false,
                            isRef: false,
                            typeStr: "Object"
                        }
                    case "array":
                        var itemsTypeObject = typeForObject(obj.items)

                        return {
                            isArr: true,
                            isRef: itemsTypeObject.isRef,
                            typeStr: obj.items ? itemsTypeObject.typeStr : "AnyObject"
                        }
                        break
                    case "string":
                    case "integer":
                    case "number":
                    case "boolean":
                    case "any":
                        return {
                            isArr: false,
                            isRef: false,
                            typeStr: BASIC_TYPES[obj.type]
                        }
                        break
                    default:
                        DEBUG("type not handled:", obj.type)
                        break
                }
                break
            default:
                // cf. https://spacetelescope.github.io/understanding-json-schema/reference/type.html
                DEBUG("typeof not handled:", typeof obj.type)
                break
        }
    }
}

function prepareExtends(superClass) {
    var extendArray = []

    if (superClass) {
        extendArray.push(superClass)
    }

    var isStruct = argv['use-struct']

    var inherits = argv.inherits
    if (inherits && inherits.length) {
        if (isStruct) { return INFO("inheritance ignored with struct") }

        extendArray = inherits
    }

    var protocols = argv.protocols
    if (!superClass && protocols && protocols.length) {
        extendArray = extendArray.concat(protocols)
    }

    return extendArray
}
