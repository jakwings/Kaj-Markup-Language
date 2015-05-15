(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff
var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined' && object.buffer instanceof ArrayBuffer) {
    return fromTypedArray(that, object)
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = String(string)

  if (string.length === 0) return 0

  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      return string.length
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return string.length * 2
    case 'hex':
      return string.length >>> 1
    case 'utf8':
    case 'utf-8':
      return utf8ToBytes(string).length
    case 'base64':
      return base64ToBytes(string).length
    default:
      return string.length
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function toString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []
  var i = 0

  for (; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (leadSurrogate) {
        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        } else {
          // valid surrogate pair
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      } else {
        // no lead yet

        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else {
          // valid lead
          leadSurrogate = codePoint
          continue
        }
      }
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":2,"ieee754":3,"is-array":4}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],3:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],4:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],5:[function(require,module,exports){
var clone = require('clone');
var extend = require('extend');
var helpers = require('./helpers.js');
var parseOptions = helpers.parseOptions;
var throwError = helpers.throwError;
var getIndent = helpers.getIndent;
var trim = helpers.trim;
var pad = helpers.pad;

var Tnode = require('./class-tnode.js');

var BlockLexer = function (opts) {
  var InlineLexer = require('./class-inlinelexer.js');
  var Renderer = require('./class-renderer.js');
  this.options = opts;
  this._inlineLexer = new InlineLexer(opts);
  this._helpers = extend(clone(helpers, false), {
    clone: clone,
    extend: extend,
    options: this.options,
    blockLexer: this,
    inlineLexer: this._inlineLexer,
    Tnode: Tnode,
    InlineLexer: InlineLexer,
    BlockLexer: BlockLexer,
    Renderer: Renderer
  });
  this.lines = [];
  this.ast = new Tnode({type: '_root_'}, true);
  this._markers = {
    'b_section': /^(==*)(.*)/,
    'b_ul_item': /^([*+\-]) (.*)/,
    'b_ol_item': /^#(\d\d*(?:\.\d\d*)*) (.*)/,
    'b_lb_line': /^\|(?: (.*)|$)/,
    'b_code': /^~\/\/([^ \t\f]*)(.*)/,
    'b_oneliner': /^~\/ (.*)/,
    'b_directive': /^\.\.(?: ([^ \t\f\{]+)\{([^{}]*)\}(.*)| (.*)|$)/,
    'b_paragraph': null
  };
  this._directives = {};
  this._directiveQueues = {
    'before': [],  // before inline-lexing
    'after': []    // after inline-lexing
  };
  for (var state in opts.directives) {
    var directives = opts.directives[state];
    for (var name in directives) {
      this.registerDirective(state, name, directives[name]);
    }
  }
  var directiveSection = this.getDirective('#section');
  if (directiveSection) {
    this.scheduleDirective(directiveSection);
  }
};

BlockLexer.lex = function (src, opts) {
  return (new BlockLexer(opts)).lex(src);
};

BlockLexer.prototype.lex = function (src) {
  this.lines = src.split(/(?:\n|\r\n?)/);
  var lastIndex = this.tokenize(this.ast, 0, 0);
  this.lines.splice(0, lastIndex);
  this.executeDirective('before');
  var inlineLexer = this._inlineLexer;
  this.ast.traverse(function (node) {
    if (/^(?:b_paragraph|b_lb_line|_fragment_)$/.test(node.type)) {
      inlineLexer.lex(node);
    }
  });
  this.executeDirective('after');
  return this.ast;
};

BlockLexer.prototype.tokenize = function (root, row, indent, type) {
  var lines = this.lines;
  var markers = this._markers;
  var node;
  for (var i = row, l = lines.length; i < l; i++) {
    var line = lines[i];
    var lineIndent = getIndent(line);
    if (lineIndent === false) {
      if (type !== 'i_text') {
        continue;  // ignore blank lines
      }
    } else if (lineIndent < indent) {
      return i;
    } else if (lineIndent > indent) {
      if (type !== 'i_text') {
        if (!type) {
          node = new Tnode({type: 'b_indented'}, true);
          node.parentNode = root;
          i = this.tokenize(node, i, lineIndent) - 1;
          root.addNode(node);
          continue;
        } else {
          return i;
        }
      }
    }
    line = line.substr(indent);

    if (type === 'i_text') {
      root.addNode(new Tnode({type: 'i_text', text: line}));
      continue;
    }

    LOOP_MARKER:
    for (var markerName in markers) {
      var marker = markers[markerName];
      var matches = null;
      switch (markerName) {

        case 'b_section':
          if (matches = marker.exec(line)) {
            var sectTitle = trim(matches[2]).replace(/ *==*$/, '');
            if ((matches[2][0] !== ' ') && sectTitle) {
              break;
            }
            if (type && (markerName !== type)) { return i; }
            var sectSize = matches[1].length;
            if (sectTitle) {
              if ((root.type === markerName) && (root.size >= sectSize)) {
                return i;
              }
              node = new Tnode({
                type: markerName,
                size: sectSize
              }, true);
              node.addNode(new Tnode({
                type: 'b_heading',
                size: sectSize,
                text: sectTitle
              }));
              node.parentNode = root;
              i = this.tokenize(node, i + 1, indent) - 1;
              if ((root.type === markerName) && (sectSize - root.size > 1)) {
                sectSize = sectSize - 1;
                while (sectSize > root.size) {
                  node = new Tnode({
                    type: markerName,
                    size: sectSize
                  }, node);
                  sectSize = sectSize - 1;
                }
              } else if ((root.type !== markerName) && (sectSize > 1)) {
                sectSize = sectSize - 1;
                while (sectSize > 0) {
                  node = new Tnode({
                    type: markerName,
                    size: sectSize
                  }, node);
                  sectSize = sectSize - 1;
                }
              }
              root.addNode(node);
            } else {
              if ((root.type === markerName) && (root.size > sectSize)) {
                return i;
              }
            }
            break LOOP_MARKER;
          }
          break;

        case 'b_ul_item':
          if (matches = marker.exec(line)) {
            if (type && (markerName !== type)) { return i; }
            if (root.type === 'b_ul_block') {
              node = new Tnode({
                type: markerName,
                mark: matches[1]
              }, true);
              var ulIndent = 2;
              var ulIndex = i;
              this.lines[ulIndex] = pad(indent + ulIndent) + matches[2];
              node.parentNode = root;
              i = this.tokenize(node, i, indent + ulIndent) - 1;
              this.lines[ulIndex] = pad(indent) + line;
              if (node.childNodes.length > 1) {
                root.complex = true;
              }
            } else {
              node = new Tnode({type: 'b_ul_block'}, true);
              node.parentNode = root;
              i = this.tokenize(node, i, indent, markerName) - 1;
            }
            root.addNode(node);
            break LOOP_MARKER;
          }
          break;

        case 'b_ol_item':
          if (matches = marker.exec(line)) {
            if (type && (markerName !== type)) { return i; }
            if (root.type === 'b_ol_block') {
              node = new Tnode({
                type: markerName,
                mark: matches[1]
              }, true);
              var olIndent = matches[1].length + 2;
              var olIndex = i;
              this.lines[olIndex] = pad(indent + olIndent) + matches[2];
              node.parentNode = root;
              i = this.tokenize(node, i, indent + olIndent) - 1;
              this.lines[olIndex] = pad(indent) + line;
              if (node.childNodes.length > 1) {
                root.complex = true;
              }
            } else {
              node = new Tnode({type: 'b_ol_block'}, true);
              node.parentNode = root;
              i = this.tokenize(node, i, indent, markerName) - 1;
            }
            root.addNode(node);
            break LOOP_MARKER;
          }
          break;

        case 'b_lb_line':
          if (matches = marker.exec(line)) {
            if (type && (markerName !== type)) { return i; }
            if (root.type === 'b_lb_block') {
              node = new Tnode({
                type: markerName,
                text: trim(matches[1] || '')
              });
            } else {
              node = new Tnode({type: 'b_lb_block'}, true);
              node.parentNode = root;
              i = this.tokenize(node, i, indent, markerName) - 1;
            }
            root.addNode(node);
            break LOOP_MARKER;
          }
          break;

        case 'b_code':
          if (matches = marker.exec(line)) {
            if (type && (markerName !== type)) { return i; }
            node = new Tnode({
              type: markerName,
              lang: matches[1],
              class: trim(matches[2])
            }, true);
            node.parentNode = root;
            i = this.tokenize(node, i + 1, indent + 3, 'i_text') - 1;
            node.text = node.getTextFromNodes('text', '\n');
            node.childNodes = null;
            root.addNode(node);
            break LOOP_MARKER;
          }
          break;

        case 'b_oneliner':
          if (matches = marker.exec(line)) {
            if (type && (markerName !== type)) { return i; }
            node = new Tnode({
              type: markerName,
              text: matches[1]
            });
            root.addNode(node);
            break LOOP_MARKER;
          }
          break;

        case 'b_directive':
          if (matches = marker.exec(line)) {
            if (type && (markerName !== type)) { return i; }
            var directiveName = matches[4] ? 'comment' : (matches[1] || '');
            if (directiveName) {
              var directive = this.getDirective(directiveName);
              if (!directive) {
                throwError('Directive "' + directiveName + '" does not exist.');
              }
              if (this.isSameDirective(directiveName, 'header') ||
                  this.isSameDirective(directiveName, 'footer')) {
                if (root.type === 'b_section') {
                  return i;
                }
              }
              node = new Tnode({
                type: markerName,
                row: i,
                indent: indent,
                queue: directive.queue,
                name: directiveName,
                args: trim(matches[2] || ''),
                text: trim(matches[3] || matches[4] || '')
              }, true);
              if (directiveName === 'comment') {
                if (matches[4]) {
                  node.args = 'true';
                  node.isImplicitComment = true;
                }
              }
              i = this.tokenize(node, i + 1, indent + 3, 'i_text') - 1;
              directive = this.setupDirective(directive, node);
              root.addNode(node);
              if (directive.queue === 'immediate') {
                this.executeDirective(directive);
              } else {
                this.scheduleDirective(directive);
              }
            }
            break LOOP_MARKER;
          }
          break;

        case 'b_paragraph':
          if (type && (markerName !== type)) { return i; }
          node = new Tnode({
            type: markerName,
            text: trim(line)
          });
          root.addNode(node);
          break LOOP_MARKER;

        default:
          throw new Error(
              'Block element "' + markerName + '" does not have a handler.');
      }
    }
  }
  return i;
};

BlockLexer.prototype.setupDirective = function (directive, node) {
  var data = {};
  if (node.childNodes && node.childNodes.length) {
    data = parseOptions(node.getTextFromNodes('text', '\n'));
  }
  if (node.text && data.normalText) {
    if ((directive.name !== 'comment') || !node.isImplicitComment) {
      throwError('Each directive can not have more than one body.');
    }
  }
  if (directive.name !== 'comment') {
    if (!data.normalText) {
      node.isOneliner = true;
    } else {
      node.text = data.normalText;
    }
  } else {
    node.text = node.text + (data.normalText ? ('\n' + data.normalText) : '');
  }
  node.opts = data.options || {};
  node.childNodes = null;
  var newDirective = {
    queue: directive.queue,
    action: directive.action.bind(null),
    node: node
  };
  return newDirective;
};

BlockLexer.prototype.getDirective = function (name) {
  return this._directives[name] || null;
};

BlockLexer.prototype.isSameDirective = function (nameA, nameB) {
  return this._directives[nameA].action === this._directives[nameB].action;
};

BlockLexer.prototype.registerDirective = function (queue, name, callback) {
  this._directives[name] = {
    name: name,
    queue: queue,
    action: callback
  };
};

BlockLexer.prototype.scheduleDirective = function (directive) {
  if (directive.queue === 'before') {
    this.setupDirective(directive, new Tnode({type: '#directive'}));
  }
  this._directiveQueues[directive.queue].push(directive);
};

BlockLexer.prototype.executeDirective = function (obj) {
  if (typeof obj === 'string') {
    var queue = this._directiveQueues[obj];
    for (var i = 0, l = queue.length; i < l; i++) {
      this.executeDirective(queue[i]);
    }
  } else {
    obj.action(obj.node, this.ast, this._helpers);
  }
};

module.exports = BlockLexer;

},{"./class-inlinelexer.js":6,"./class-renderer.js":7,"./class-tnode.js":8,"./helpers.js":10,"clone":12,"extend":13}],6:[function(require,module,exports){
var throwError = require('./helpers.js').throwError;
var trim = require('./helpers.js').trim;

var Tnode = require('./class-tnode.js');

var InlineLexer = function (opts) {
  this.options = opts;
  this._markers = {
    'i_bold':       ['{*', '*}'],
    'i_italic':     ['{/', '/}'],
    'i_standout':   ['{%', '%}'],
    'i_code':       ['{`', '`}'],
    'i_keystroke':  ['{:', ':}'],
    'i_literal':    ['``', '``'],
    'i_link':       ['[[', ']]'],
    'i_raw':        ['{{', '}}'],
    'i_role':       ['{~', '~}'],
    'i_note':       ['{[', ']}'],
    'i_anchor':     ['{#', '#}'],
    'i_pipe':       ['{|', '|}']
  };
  this._markerNames = [
    'i_bold', 'i_italic', 'i_standout', 'i_code', 'i_keystroke', 'i_literal',
    'i_link', 'i_raw', 'i_role', 'i_note', 'i_anchor', 'i_pipe'];
};

InlineLexer.lex = function (node, opts) {
  return (new InlineLexer(opts)).lex(node);
};

InlineLexer.prototype.lex = function (node) {
  if (node.childNodes || !('text' in node)) {
    return;
  }
  node.childNodes = [];
  var markers = this._markers;
  var markerNames = this._markerNames;
  var src = node.text || '';
  var chunk = '';
  while (src) {
    var step = 1;  // prefers code points, than code units
    LOOP_MARKER:
    for (var i = 0, l = markerNames.length; i < l; i++) {
      var markerName = markerNames[i];
      var marker = markers[markerName];
      var markerLeftIndex = marker[0].length;
      if (src.substr(0, markerLeftIndex) !== marker[0]) {
        continue;
      }
      var markerRightIndex = src.indexOf(marker[1], markerLeftIndex);
      if (markerRightIndex < 0) {
        throwError(
            'Inline markup "' + marker[0] + '" without "' + marker[1] + '".');
      }
      var text = src.substring(markerLeftIndex, markerRightIndex);
      if (chunk) {
        node.addNode(new Tnode({type: 'i_text', text: chunk}));
        chunk = '';
      }
      step = marker[0].length + text.length + marker[1].length;
      switch (markerName) {

        case 'i_bold':
        case 'i_italic':
        case 'i_standout':
        case 'i_literal':
          node.addNode(new Tnode({type: markerName, text: trim(text)}));
          break LOOP_MARKER;

        case 'i_code':
        case 'i_keystroke':
        case 'i_raw':
          node.addNode(new Tnode({type: markerName, text: text}));
          break LOOP_MARKER;

        case 'i_link':
          var matches = /^(.*?)(?:\|(.*))?$/.exec(text);
          node.addNode(new Tnode({
            type: markerName,
            text: trim(matches[1]),
            link: trim(matches[2] || '')
          }));
          break LOOP_MARKER;

        case 'i_role':
          var index = text.indexOf('~');
          node.addNode(new Tnode({
            type: markerName,
            name: (index < 0) ? 'general' : trim(text.substr(0, index)),
            text: (index < 0) ? text : text.substr(index + 1)
          }));
          break LOOP_MARKER;

        case 'i_note':
        case 'i_anchor':
        case 'i_pipe':
          node.addNode(new Tnode({type: markerName, name: trim(text)}));
          break LOOP_MARKER;

        default:
          throw new Error(
              'Span element "' + markerName + '" does not have a handler.');
      }
    }
    if (step === 1) {
      var spaceCount;
      for (spaceCount = 0; src[spaceCount] === ' '; spaceCount++) { ; }
      if (spaceCount > 0) {
        node.addNode(new Tnode({type: 'i_text', text: ' '}));
        chunk = '';
        src = src.substr(spaceCount);
      } else {
        chunk += src[0];
        src = src.substr(1);
        if (!src || (src[0] === ' ')) {
          node.addNode(new Tnode({type: 'i_text', text: chunk}));
          chunk = '';
        }
      }
    } else {
      src = src.substr(step);
    }
  }
  if (!node.text) {
    node.addNode(new Tnode({type: 'i_text', text: ''}));
    chunk = '';
  }
  delete node.text;
};

module.exports = InlineLexer;

},{"./class-tnode.js":8,"./helpers.js":10}],7:[function(require,module,exports){
var clone = require('clone');
var extend = require('extend');
var helpers = require('./helpers.js');
var mergeClasses = helpers.mergeClasses;
var trim = helpers.trim;

var Renderer = function (opts) {
  var Tnode = require('./class-tnode.js');
  var BlockLexer = require('./class-blocklexer.js');
  var InlineLexer = require('./class-inlinelexer.js');
  this.options = opts;
  this._helpers = extend(clone(helpers, false), {
    clone: clone,
    extend: extend,
    options: this.options,
    renderer: this,
    Tnode: Tnode,
    InlineLexer: InlineLexer,
    BlockLexer: BlockLexer,
    Renderer: Renderer
  });
};

Renderer.escape = function (text) {
  return text ? text.replace(/["'&<>]/g, function (c) {
    switch (c) {
      case '"': return '&quot;';
      case '\'': return '&#39;';
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      default: return c;
    }
  }) : '';
};
Renderer.getAttrId = function (s) {
  return s ? (' id="' + Renderer.escape(s) + '"') : '';
};
Renderer.getAttrAny = function (attr, value) {
  if (Array.isArray(value)) {
    value = value.filter(function (v) { return v && trim(v); });
    if (attr === 'class') {
      value = value.map(function (v) {
        return v.replace(/[ \t\f]+/g, '-');
      });
    }
    value = value.join(' ');
  }
  return value ? (' ' + attr + '="' + Renderer.escape(value) + '"') : '';
};
Renderer.getElement = function (elem, attrs, text, closed, raw, isBlock) {
  if (typeof attrs !== 'object') {
    isBlock = raw;
    raw = closed;
    closed = text;
    text = attrs;
    attrs = {};
  }
  var result = '<' + elem;
  for (var k in attrs) {
    if (k === 'id') {
      result += Renderer.getAttrId(attrs[k]);
    } else {
      result += Renderer.getAttrAny(k, attrs[k]);
    }
  }
  result += '>';
  if (!closed) {
    text = text || '';
    result += (isBlock ? '\n' : '') +
        (raw ? text : Renderer.escape(text)) +
        (isBlock ? '\n' : '') + '</' + elem + '>';
  }
  return result;
};
Renderer.getBlock = function (elem, attrs, text, closed, raw) {
  return Renderer.getElement(elem, attrs, text, closed, raw, true);
};
Renderer.getSpan = function (elem, attrs, text, closed, raw) {
  return Renderer.getElement(elem, attrs, text, closed, raw, false);
};

Renderer.render = function (root, opts) {
  return (new Renderer(opts)).render(root);
};

Renderer.prototype.render = function (root) {
  this._ast = root;
  var result = '';
  var self = this;
  var extractAttrs = function (node) {
    var attrs = {};
    var keys = Object.keys(node);
    for (var i = 0, l = keys.length; i < l; i++) {
      var k = keys[i];
      if (k.charAt(0) === '$') {
        attrs[k.substr(1)] = node[k];
      }
    }
    return attrs;
  };
  root.traverse(function (node) {
    var part;
    var prefix = node.type.substr(0, 2);
    switch (prefix) {
      case 'b_':
        part = self[node.type](node, self._ast, self._helpers);
        node.parentNode._html = node.parentNode._html ?
            (node.parentNode._html + '\n' + part) : part;
        delete node._html;
        break;
      case 'i_':
        part = self[node.type](node, self._ast, self._helpers);
        node.parentNode._html = (node.parentNode._html || '') + part;
        delete node._html;
        break;
      default:
        if (/^[a-z][a-z]*$/.test(node.type)) {
          var attrs = extractAttrs(node);
          var isBlock = !node.isSpan;
          var shape = isBlock ? 'getBlock' : 'getSpan';
          if (node.text) {
            part = Renderer[shape](
                node.type, attrs, node.text || '', node.isClosed, false);
          } else {
            part = Renderer[shape](
                node.type, attrs, node._html || '', node.isClosed, true);
          }
          if (!node.parentNode) {
            result = (isBlock ? '\n' : '') + part;
            return false;
          }
          node.parentNode._html = (node.parentNode._html || '') +
              ((node.parentNode._html && isBlock) ? '\n' : '') + part;
        } else if (node.type === '_fragment_') {
          part = node._html || '';
          if (!node.parentNode) {
            result = part;
            return false;
          }
          node.parentNode._html = (node.parentNode._html || '') + part;
        } else if (node.type === '_root_') {
          //result = '<div class="kaj-doc">\n' + (node._html || '') + '\n</div>';
          result = (node._html || '').replace(/^\n+|\n+$/g, '');
        } else {
          result = node._html || '';
        }
        delete node._html;
    }
  });
  return result;
};

Renderer.prototype.b_section = function (node, root, helpers) {
  var type = (node.size === 1) ? 'div' : 'section';
  return Renderer.getBlock(type, {
    id: node.$id || node.id,
    class: mergeClasses('kaj-section', node.$class),
    style: node.$style,
    title: node.$title
  }, node._html || '', false, true);
};
Renderer.prototype.b_heading = function (node, root, helpers) {
  // http://www.w3.org/html/wg/drafts/html/master/sections.html#headings-and-sections
  var part = node.link ?
      Renderer.getSpan('a', {href: encodeURI(node.link)}, node.text || '') :
      Renderer.getSpan('span', node.text || '');
  var type = (node.size < 7) ? ('h' + node.size) : 'p';
  return Renderer.getSpan(type, {
    id: node.$id,
    class: mergeClasses('kaj-title', node.$class),
    style: node.$style,
    title: node.$title
  }, part, false, true);
};
Renderer.prototype.b_ul_item = function (node, root, helpers) {
  var className = '';
  switch (node.mark) {
    case '*': className = 'kaj-item-x'; break;
    case '+': className = 'kaj-item-y'; break;
    case '-': className = 'kaj-item-z'; break;
    default: break;
  }
  return Renderer.getSpan('li', {
    id: node.$id,
    class: mergeClasses(className, node.$class),
    style: node.$style,
    title: node.$title
  }, node._html || '', false, true);
};
Renderer.prototype.b_ul_block = function (node, root, helpers) {
  return Renderer.getBlock('ul', {
    id: node.$id,
    class: node.$class,
    style: node.$style,
    title: node.$title
  }, node._html || '', false, true);
};
Renderer.prototype.b_ol_item = function (node, root, helpers) {
  return Renderer.getSpan('li', {
    id: node.$id,
    class: node.$class,
    style: node.$style,
    title: node.$title
  }, node._html || '', false, true);
};
Renderer.prototype.b_ol_block = function (node, root, helpers) {
  return Renderer.getBlock('ol', {
    id: node.$id,
    class: node.$class,
    style: node.$style,
    title: node.$title
  }, node._html || '', false, true);
};
Renderer.prototype.b_lb_line = function (node, root, helpers) {
  return Renderer.getSpan('div', {
    id: node.$id,
    class: mergeClasses('kaj-line', node.$class),
    style: node.$style,
    title: node.$title
  }, node._html ? node._html : Renderer.getSpan('br', '', true), false, true);
};
Renderer.prototype.b_lb_block = function (node, root, helpers) {
  return Renderer.getBlock('div', {
    id: node.$id,
    class: mergeClasses('kaj-line-block', node.$class),
    style: node.$style,
    title: node.$title
  }, node._html || '', false, true);
};
Renderer.prototype.b_code = function (node, root, helpers) {
  var result;
  var highlight = this.options.highlight;
  if (highlight) {
    result = highlight(node.text, node.lang);
  }
  return Renderer.getBlock('pre', {
    id: node.$id,
    class: mergeClasses(
        node.lang && ('lang-' + node.lang), node.class, node.$class),
    style: node.$style,
    title: node.$title
  }, result ? result : node.text, false, !!result);
};
Renderer.prototype.b_oneliner = function (node, root, helpers) {
  var result;
  var highlight = this.options.highlight;
  if (highlight) {
    result = highlight(node.text, node.lang);
  }
  return Renderer.getSpan('pre', {
    id: node.$id,
    class: mergeClasses('kaj-oneliner', node.$class),
    style: node.$style,
    title: node.$title
  }, result ? result : node.text, false, !!result);
};
Renderer.prototype.b_paragraph = function (node, root, helpers) {
  if ((node.parentNode.type === 'b_ul_item') ||
      (node.parentNode.type === 'b_ol_item')) {
    if (!node.parentNode.parentNode.complex) {
      return node._html || '';
    }
  }
  return Renderer.getSpan('p', {
    id: node.$id,
    class: node.$class,
    style: node.$style,
    title: node.$title
  }, node._html || '', false, true);
};
Renderer.prototype.b_indented = function (node, root, helpers) {
  return Renderer.getBlock('blockquote', {
    id: node.$id,
    class: mergeClasses('kaj-indented', node.$class),
    style: node.$style,
    title: node.$title
  }, node._html || '', false, true);
};
Renderer.prototype.b_raw = function (node, root, helpers) {
  return node.text ? node.text : '';
};
Renderer.prototype.i_raw = function (node, root, helpers) {
  return node.text || '';
};
Renderer.prototype.i_text = function (node, root, helpers) {
  return Renderer.escape(node.text);
};
Renderer.prototype.i_bold = function (node, root, helpers) {
  return Renderer.getSpan('b', {
    id: node.$id,
    class: node.$class,
    style: node.$style,
    title: node.$title
  }, node.text);
};
Renderer.prototype.i_italic = function (node, root, helpers) {
  return Renderer.getSpan('i', {
    id: node.$id,
    class: node.$class,
    style: node.$style,
    title: node.$title
  }, node.text);
};
Renderer.prototype.i_standout = function (node, root, helpers) {
  return Renderer.getSpan('b', {
    id: node.$id,
    class: node.$class,
    style: node.$style,
    title: node.$title
  }, Renderer.getSpan('i', node.text), false, true);
};
Renderer.prototype.i_code = function (node, root, helpers) {
  return Renderer.getSpan('code', {
    id: node.$id,
    class: node.$class,
    style: node.$style,
    title: node.$title
  }, node.text);
};
Renderer.prototype.i_keystroke = function (node, root, helpers) {
  return Renderer.getSpan('kbd', {
    id: node.$id,
    class: node.$class,
    style: node.$style,
    title: node.$title
  }, node.text);
};
Renderer.prototype.i_literal = function (node, root, helpers) {
  return Renderer.getSpan('span', {
    id: node.$id,
    class: mergeClasses('kaj-inline-literal', node.$class),
    style: node.$style,
    title: node.$title
  }, node.text);
};
Renderer.prototype.i_link = function (node, root, helpers) {
  if (!node.link) {
    node.link = node.text;
  } else {
    var matches;
    if (matches = /^=(\d\d*(?:\.\d\d*)*)=$/.exec(node.link)) {
      node.link = '#kaj-section-' + matches[1].replace(/\./g, '-');
    } else if (matches = /^#(.+)#$/.exec(node.link)) {
      node.link = '#kaj-anchor-def-' + matches[1];
    } else if (matches = /^~(.+)~$/.exec(node.link)) {
      node.link = /^\d\d*$/.test(matches[1]) ?
          ('#kaj-note-def-' + matches[1]) : ('#kaj-cite-def-' + matches[1]);
    }
  }
  var type = (node.link[0] === '#') ? 'internal' : 'external';
  return Renderer.getSpan('a', {
    id: node.$id,
    class: mergeClasses('kaj-link-' + type,
                        (node.link === node.text) ? 'kaj-link-raw' : null,
                        node.$class),
    style: node.$style,
    title: node.$title,
    href: encodeURI(node.link)
  }, node.text);
};
Renderer.prototype.i_anchor = function (node, root, helpers) {
  if (!node.name) { return ''; }
  return Renderer.getSpan('span', {
    id: node.$id || ('kaj-anchor-def-' + node.name),
    class: mergeClasses('kaj-anchor-def', node.$class),
    style: node.$style,
    title: node.$title
  }, '');
};
Renderer.prototype.i_pipe = function (node, root, helpers) {
  if (!node.name) { return ''; }
  return Renderer.getSpan('span', {
    id: node.$id,
    class: mergeClasses('kaj-pipe', node.$class),
    style: node.$style,
    title: node.$title
  }, node.name);
};
Renderer.prototype.i_note = function (node, root, helpers) {
  if (!node.name) { return ''; }
  if (/^\d\d*$/.test(node.name)) {
    return Renderer.getSpan('a', {
      id: node.$id,
      class: mergeClasses('kaj-note-ref', node.$class),
      style: node.$style,
      title: node.$title,
      href: '#kaj-note-def-' + node.name
    }, Renderer.getSpan('sup', node.name), false, true);
  } else {
    return Renderer.getSpan('a', {
      id: node.$id,
      class: mergeClasses('kaj-cite-ref', node.$class),
      style: node.$style,
      title: node.$title,
      href: '#kaj-cite-def-' + encodeURI(node.name)
    }, node.name);
  }
};
Renderer.prototype.i_role = function (node, root, helpers) {
  if (/^[ \t\f]*$/.test(node.name || '')) { return ''; }
  var roles = this.options.roles;
  if (roles[node.name]) {
    return roles[node.name](node, this._ast, this._helpers);
  }
  return Renderer.getSpan('span', {
    id: node.$id,
    class: mergeClasses('kaj-role-' + node.name, node.$class),
    style: node.$style,
    title: node.$title
  }, node.text);
};

module.exports = Renderer;

},{"./class-blocklexer.js":5,"./class-inlinelexer.js":6,"./class-tnode.js":8,"./helpers.js":10,"clone":12,"extend":13}],8:[function(require,module,exports){
var rtrimTextBlock = require('./helpers.js').rtrimTextBlock;

var Tnode = function (attrs, children) {
  this.id = this.class = this.style = '';
  var keys = Object.keys(attrs);
  for (var i = 0, l = keys.length; i < l; i++) {
    var k = keys[i];
    if (attrs[k] !== undefined) { this[k] = attrs[k]; }
  }
  this.text = this.text || '';
  this.$id = this.$id || '';
  this.$title = this.$title || '';
  this.$style = this.$style || '';
  this.$class = this.$class || '';
  this.childNodes = children ? [] : null;
  if (children instanceof Tnode) {
    this.addNode(children);
  } else if (Array.isArray(children)) {
    this.addNodes(children);
  }
  this.parentNode = null;
};

Tnode.prototype.addNode = function (node) {
  this.childNodes.push(node);
  node.parentNode = this;
};

Tnode.prototype.addNodes = function (nodes) {
  for (var i = 0, l = nodes.length; i < l; i++) {
    this.addNode(nodes[i]);
  }
};

Tnode.prototype.replaceNode = function (oldNode, newNode) {
  var index = this.childNodes.indexOf(oldNode);
  if (index >= 0) {
    if (!Array.isArray(newNode)) {
      this.childNodes[index] = newNode;
      newNode.parentNode = this;
    } else {
      this.insertNode(index, newNode);
      oldNode.parentNode.removeNode(oldNode);
    }
    oldNode.parentNode = null;
  }
};

Tnode.prototype.insertNode = function (index, newNode) {
  if (!Array.isArray(newNode)) {
    this.childNodes.splice(index, 0, newNode);
    newNode.parentNode = this;
  } else {
    this.childNodes.splice.apply(this.childNodes, [index, 0].concat(newNode));
    for (var i = 0, l = newNode.length; i < l; i++) {
      newNode[i].parentNode = this;
    }
  }
};

Tnode.prototype.getNthNode = function (n) {
  return this.childNodes[n-1] || null;
};

Tnode.prototype.getTextFromNodes = function (attr, delimiter) {
  var children = this.childNodes || [];
  var length = children.length;
  var result = [];
  for (var i = 0; i < length; i++) {
    result.push(children[i][attr] || '');
  }
  return rtrimTextBlock(result.join(delimiter));
};

Tnode.prototype.removeNode = function (node) {
  var index = this.childNodes.indexOf(node);
  if (index >= 0) {
    this.childNodes.splice(index, 1);
  }
  node.parentNode = null;
};

Tnode.prototype.remove = function () {
  this.parentNode.removeNode(this);
};

Tnode.prototype.replace = function (node) {
  this.parentNode.replaceNode(this, node);
};

Tnode.prototype.traverse = function (callback, bfs) {
  if (!bfs) {
    if (this.childNodes) {
      var children = this.childNodes;
      LOOP_DFS:
      for (var i = 0, l = children.length; i < l; i++) {
        if (children[i]) {
          switch (children[i].traverse(callback, bfs)) {
            case false: return false;   // cancels traversing
            case true: break LOOP_DFS;  // checks the next sibling
            default: break;             // checks the next child
          }
        }
      }
    }
    return callback(this);
  } else {
    var t = callback(this);
    if ((t === true) || (t === false)) {
      return t;
    }
    if (this.childNodes) {
      var nextChildren = [];
      var children = this.childNodes;
      do {
        LOOP_BFS:
        for (var i = 0, l = children.length; i < l; i++) {
          if (children[i]) {
            switch (callback(children[i])) {
              case false: return false;      // cancels traversing
              case true: continue LOOP_BFS;  // drop the rest of this branch
              default: break;                // drop this node
            }
            if (children[i].childNodes) {
              nextChildren = nextChildren.concat(children[i].childNodes);
            }
          }
        }
        children = nextChildren;
        nextChildren = [];
      } while (children.length);
    }
  }
};

module.exports = Tnode;

},{"./helpers.js":10}],9:[function(require,module,exports){
module.exports = {
  /**
   * helpers = {
   *   options: kaj.options,
   *   Tnode: kaj.Tnode,
   *   blockLexer: (blockLexer),
   *   BlockLexer: kaj.BlockLexer,
   *   inlineLexer: (inlineLexer),
   *   InlineLexer: kaj.InlineLexer,
   *   Renderer: kaj.Renderer,
   *   ltrimTextBlock: ltrimTextBlock,
   *   rtrimTextBlock: rtrimTextBlock,
   *   mergeClasses: mergeClasses,
   *   parseOptions: parseOptions,
   *   throwError: throwError,
   *   getIndent: getIndent,
   *   trim: trim,
   *   pad: pad
   * }
   */

  // before inline-lexing
  before: {
    /**
     * Does auto indexing for titles with directive "contents".
     */
    '#section': function (node, root, helpers) {
      var depth = 6;
      var modify = function (node) {
        if (node === this.root) { return; }
        if (node.type !== 'b_section') { return true; }
        if (node.size > depth) { return false; }
        var section = node;
        var size = section.size;
        var counters = this.counters;
        if (size > counters.length) {
          counters[size-1] = 0;
        }
        counters[size-1] += 1;
        var name = counters.slice(0, size).join('-');
        section.id = 'kaj-section-' + name;
        if (section.childNodes && (size < depth)) {
          section.traverse(modify.bind({
            root: section,
            counters: counters.slice(0, size)  // copy
          }), true);
        }
        return true;
      };
      root.traverse(modify.bind({
        root: root,
        counters: []
      }), true);
    },
    /**
     * Defines a simple text role.
     * Syntax:
     *   .. role{role name}
     *      :id:
     *      :class:
     *      :style:
     *      :title:
     *      :wrapper: span
     */
    'role': function (node, root, helpers) {
      node.parentNode.removeNode(node);
      var name = node.args;
      if (!name || /^[ \t\f~]|[ \t\f~]$/.test(name)) {
        helpers.throwError('Directive "role": invalid role name');
      }
      var opts = node.opts;
      var wrapper = opts.wrapper || 'span';
      // http://www.w3.org/html/wg/drafts/html/master/syntax.html#data-state
      if (/^!--|[<>\/?\x00]/.test(wrapper)) {
        helpers.throwError(
            'Directive "role": invalid value for option "wrapper"');
      }
      var className = opts.class;
      if (className) {
        className = className.split(/[ \t\f]+/);
      }
      var roles = helpers.options.roles;
      roles[name] = function (node, root, helpers) {
        return helpers.Renderer.getSpan(wrapper, {
          id: opts.id || node.$id,
          class: helpers.mergeClasses(className, node.$class),
          style: (opts.style ? (opts.style + ';') : '') + node.$style,
          title: opts.title || node.$title
        }, node.text);
      };
    }
  },

  immediate: {
    /**
     * Sets metadata on root.
     * Syntax:
     *   .. @{table name}
     *      :key1: value1
     *      :key2: value2
     *      :keyN: valueN
     */
    '@': function (node, root) {
      var args = node.args;
      var opts = node.opts;
      if (args) {
        var key = '#' + args;
        root[key] = {};
        for (var k in opts) {
          if (Object.prototype.hasOwnProperty.call(opts, k)) {
            root[key][k] = opts[k];
          }
        }
      }
      node.parentNode.removeNode(node);
    },
    /**
     * Inserts raw code to the output.
     * Syntax:
     *   .. raw{html} body
     */
    raw: function (node, root, helpers) {
      var format = node.args;
      if (format === 'html') {
        node.parentNode.replaceNode(node, new helpers.Tnode({
          type: 'b_raw',
          text: helpers.ltrimTextBlock(node.text)
        }));
      } else {
        node.parentNode.removeNode(node);
      }
    },
    /**
     * Inserts comments.
     * Syntax:
     *   .. comments line 1
     *      comments line 2
     *
     *   .. comment{true} comments
     */
    comment: function (node, root, helpers) {
      if (node.args === 'true') {
        var ltrimTextBlock = helpers.ltrimTextBlock;
        node.parentNode.replaceNode(node, new helpers.Tnode({
          type: 'b_raw',
          text: ltrimTextBlock(node.text).split('\n').map(function (line, i) {
            line = line.replace(/-->/g, '- ->');
            if (i > 0) {
              return line ? ('     ' + line) : '';
            }
            return '<!-- ' + line;
          }).join('\n') + ' -->'
        }));
      } else {
        node.parentNode.removeNode(node);
      }
    },
    /**
     * Makes an alias for a role or a directive.
     * Syntax:
     *   .. alias{role} old name
     *      :to: new name
     *
     *   .. alias{directive} old name
     *      :to: new name
     */
    'alias': function (node, root, helpers) {
      node.parentNode.removeNode(node);
      if (!node.isOneliner) {
        helpers.throwError('Directive "alias": invalid syntax');
      }
      var oldName = node.text;
      if (!oldName || /^[# \t\f~]|[ \t\f~]$/.test(oldName)) {
        helpers.throwError('Directive "alias": invalid old name');
      }
      var newName = node.opts.to;
      if (!newName || /^[# \t\f]|[ \t\f]$/.test(newName) ||
          /[{}]/.test(newName)) {
        helpers.throwError('Directive "alias": invalid new name');
      }
      var type = node.args;
      if (type === 'role') {
        var roles = helpers.options.roles;
        roles[newName] = roles[oldName];
      } else if (type === 'directive') {
        var directives = helpers.options.directives;
        var directive;
        if (directives['before'][oldName]) {
          directive = directives['before'][newName] = directives['before'][oldName];
          helpers.blockLexer.registerDirective('before', newName, directive);
        } else if (directives['immediate'][oldName]) {
          directive = directives['immediate'][newName] = directives['immediate'][oldName];
          helpers.blockLexer.registerDirective('immediate', newName, directive);
        } else if (directives['after'][oldName]) {
          directive = helpers.options.directives['after'][newName] = directives['after'][oldName];
          helpers.blockLexer.registerDirective('after', newName, directive);
        }
      }
    },
    /**
     * Adds one class to the nodes.
     * Syntax:
     *   .. class{class names} text
     *
     *   .. class{class names}
     *      nodes...
     */
    class: function (node, root, helpers) {
      var Tnode = helpers.Tnode;
      var opts = node.opts;
      var className = opts.class || node.args;
      var row = node.row + Object.keys(node.opts).length + 1;
      var indent = node.indent + 3;
      var parentNode = node.parentNode;
      if (className) {
        className = className.split(/[ \t\f]+/);
      }
      if (!node.isOneliner) {
        var newNode = new Tnode({type: ''}, true);
        newNode.parentNode = parentNode;
        helpers.blockLexer.tokenize(newNode, row, indent);
        var nodes = newNode.childNodes;
        for (var i = 0, l = nodes.length; i < l; i++) {
          if (className) {
            nodes[i].$class = nodes[i].$class ?
                helpers.mergeClasses(nodes[i].$class, className) : className;
          }
          if (opts.id) {
            nodes[i].$id = opts.id;
            opts.id = null;
          }
          if (opts.style) {
            nodes[i].$style += (nodes[i].$style ? ';' : '') + opts.style;
          }
          if (opts.title) {
            nodes[i].$title = opts.title;
          }
        }
        parentNode.replaceNode(node, nodes);
      } else {
        node.text = helpers.ltrimTextBlock(node.text);
        var newNode = new Tnode({
          type: 'div',
          isSpan: true,
          $id: opts.id,
          $class: className,
          $style: opts.style,
          $title: opts.title
        }, new Tnode({type: '_fragment_', text: node.text}));
        parentNode.replaceNode(node, newNode);
      }
    },
    /**
     * Wraps the nodes with a block node.
     * Syntax:
     *   .. block{class names} text
     *
     *   .. block{class names}
     *      nodes...
     */
    block: function (node, root, helpers) {
      var Tnode = helpers.Tnode;
      var opts = node.opts;
      var className = opts.class || node.args;
      if (className) {
        className = className.split(/[ \t\f]+/);
      }
      var newNode = new Tnode({
        type: 'div',
        $id: opts.id,
        $class: className,
        $style: opts.style,
        $title: opts.title
      }, true);
      if (!node.isOneliner) {
        newNode.parentNode = node.parentNode;
        helpers.blockLexer.tokenize(
            newNode, node.row + Object.keys(opts).length + 1, node.indent + 3);
        node.parentNode.replaceNode(node, newNode);
      } else {
        node.text = helpers.ltrimTextBlock(node.text);
        newNode.isSpan = true;
        newNode.addNode(new Tnode({type: '_fragment_', text: node.text}));
        node.parentNode.replaceNode(node, newNode);
      }
    },
    /**
     * Wraps the nodes in a block node.
     * Syntax:
     *   .. header{} text
     *
     *   .. header{}
     *      nodes...
     */
    header: function (node, root, helpers) {
      var Tnode = helpers.Tnode;
      var opts = node.opts;
      var className = opts.class;
      if (className) {
        className = className.split(/[ \t\f]+/);
      }
      var newNode = new Tnode({
        type: 'header',
        $id: opts.id,
        $class: className,
        $style: opts.style,
        $title: opts.title
      }, true);
      if (!node.isOneliner) {
        newNode.parentNode = node.parentNode;
        helpers.blockLexer.tokenize(
            newNode, node.row + Object.keys(opts).length + 1, node.indent + 3);
        node.parentNode.replaceNode(node, newNode);
      } else {
        node.text = helpers.ltrimTextBlock(node.text);
        if (node.text) {
          newNode.isSpan = true;
          newNode.addNode(new Tnode({type: '_fragment_', text: node.text}));
          node.parentNode.replaceNode(node, newNode);
        } else {
          node.parentNode.removeNode(node);
        }
      }
    },
    /**
     * Wraps the nodes in a block node.
     * Syntax:
     *   .. footer{} text
     *
     *   .. footer{}
     *      nodes...
     */
    footer: function (node, root, helpers) {
      var Tnode = helpers.Tnode;
      var opts = node.opts;
      var className = opts.class;
      if (className) {
        className = className.split(/[ \t\f]+/);
      }
      var newNode = new Tnode({
        type: 'footer',
        $id: opts.id,
        $class: className,
        $style: opts.style,
        $title: opts.title
      }, true);
      if (!node.isOneliner) {
        newNode.parentNode = node.parentNode;
        helpers.blockLexer.tokenize(
            newNode, node.row + Object.keys(opts).length + 1, node.indent + 3);
        node.parentNode.replaceNode(node, newNode);
      } else {
        if (node.text) {
          node.text = helpers.ltrimTextBlock(node.text);
          newNode.isSpan = true;
          newNode.addNode(new Tnode({type: '_fragment_', text: node.text}));
          node.parentNode.replaceNode(node, newNode);
        } else {
          node.parentNode.removeNode(node);
        }
      }
    },
    /**
     * Inserts an image.
     * Syntax:
     *   .. image{format} src or srcset
     *      :alt: alternative text
     *      :caption: a caption for the figure
     *      :link: URI
     *      :lazyload: true or false
     */
    image: function (node, root, helpers) {
      var Tnode = helpers.Tnode;
      var mergeClasses = helpers.mergeClasses;
      var format = node.args.replace(/[ \t\f]+/g, '-');
      var srcset = helpers.ltrimTextBlock(node.text);
      var opts = node.opts;
      var className = opts.class;
      if (className) {
        className = className.split(/[ \t\f]+/);
      }
      opts.id = opts.id || '';
      opts.class = opts.class || '';
      opts.style = opts.style || '';
      opts.title = opts.title || '';
      opts.caption = opts.caption || '';
      var isSimple = (opts.simple === 'true');
      className = format ? mergeClasses('kaj-image-' + format, className)
                         : className;
      var newNode = new Tnode({
        type: 'img',
        isClosed: true,
        $id: isSimple ? opts.id : '',
        $class: isSimple ? className : '',
        $style: opts.style,
        $title: isSimple ? opts.title : '',
        $alt: opts.alt
      }, false);
      var valSrc = encodeURI(srcset.split(/  */, 1)[0]);
      var valSrcSet = / /.test(srcset) &&
          srcset.split(/ *,  */).map(function (src) {
            var parts = src.split(/  */);
            parts[0] = encodeURI(parts[0]);
            return parts.join(' ');
          }).join(', ');
      var keySrc, keySrcSet;
      if (opts.lazyload !== 'true') {
        keySrc = '$src';
        keySrcSet = '$srcset';
      } else {
        keySrc = '$data-src';
        keySrcSet = '$data-srcset';
      }
      newNode[keySrc] = valSrc;
      newNode[keySrcSet] = valSrcSet;
      if (opts.link) {
        newNode = new Tnode({
          type: 'a',
          isSpan: true,
          $href: encodeURI(opts.link)
        }, newNode);
      }
      if (!isSimple) {
        newNode = new Tnode({
          type: 'figure',
          $id: opts.id,
          $class: className,
          $title: opts.title
        }, newNode);
        if (opts.caption) {
          newNode.addNode(new Tnode({
            type: 'figcaption',
            isSpan: true
          }, new Tnode({type: '_fragment_', text: opts.caption})));
        }
      }
      node.parentNode.replaceNode(node, newNode);
    },
    /**
     * Inserts a note.
     * Syntax:
     *   .. note{Note Number or Citation Name}
     *      nodes...
     */
    note: function (node, root, helpers) {
      var defName = node.args;
      if (!defName) {
        node.parentNode.removeNode(node);
        return;
      }
      var Tnode = helpers.Tnode;
      var defText = helpers.ltrimTextBlock(node.text);
      var opts = node.opts;
      var className = opts.class;
      if (className) {
        className = className.split(/[ \t\f]+/);
      }
      var isCitation = !/^\d\d*$/.test(defName);
      var newNode = new Tnode({type: '_fragment_'}, true);
      if (!node.isOneliner) {
        newNode.parentNode = node.parentNode;
        helpers.blockLexer.tokenize(
            newNode, node.row + Object.keys(opts).length + 1, node.indent + 3);
      } else {
        newNode.text = defText;
        newNode.childNodes = null;
      }
      newNode = new Tnode({type: 'tr'}, [
        new Tnode({
          type: 'td',
          isSpan: true,
          $class: 'kaj-label',
          text: '[' + defName + ']'
        }),
        new Tnode({type: 'td', isSpan: node.isOneliner}, newNode)
      ]);
      newNode = new Tnode({
        type: 'table',
        $class: helpers.mergeClasses(
            'kaj-' + (isCitation ? 'cite-def' : 'note-def'), className),
        $id: opts.id || ('kaj-' + (isCitation ? 'cite-def-' : 'note-def-') +
            encodeURI(defName))
      }, newNode);
      node.parentNode.replaceNode(node, newNode);
    },
    /**
     * Inserts a Comma-Separated-Values table.
     * Syntax:
     *   .. csv-table{Caption}
     *      :header: true|false true|false (has Header Row?) (has Header Column?)
     *      :delimiter: , (used to indicate columns, default: ",")
     *      :linebreak: (used to indicate linebreaks in a cell, default:)
     *      r1-c1 , r1-c2 , r1-c3
     *      r2-c1 , r2-c2 , r2-c3
     *      r3-c1 , r3-c2 , r3-c3
     */
    'csv-table': function (node, root, helpers) {
      var Tnode = helpers.Tnode;
      var ltrimTextBlock = helpers.ltrimTextBlock;
      var caption = node.args;
      var opts = node.opts;
      var className = opts.class;
      if (className) {
        className = className.split(/[ \t\f]+/);
      }
      var headerFlags = (opts.header || '').split(/[ \t]+/, 2).map(function (v) {
        return v === 'true';
      });
      var delimiter = opts.delimiter || ',';
      var linebreak = opts.linebreak || false;
      var rows = ltrimTextBlock(node.text).split('\n').map(function (line) {
        return line.split(delimiter);
      }).filter(function (cells) {
        return cells.length;
      });
      var newNode = new Tnode({
        type: 'table',
        $id: opts.id,
        $class: className,
        $style: opts.style,
        $title: opts.title
      }, caption ? new Tnode({type: 'caption', isSpan: true, text: caption}) : true);
      if (linebreak) {
        linebreak = new RegExp('[ \\t]*' +
            linebreak.replace(/([.\\+*?\^\[\]$(){}])/g, '\\$1') + '[ \\t]*', 'g');
      }
      var cell, row;
      if (headerFlags[0]) {
        var header = false;
        if (row = rows.shift()) {
          header = new Tnode({type: 'tr'}, true);
          for (var i = 0, l = row.length; i < l; i++) {
            text = helpers.trim(row[i]);
            if (linebreak) {
              text = text.replace(linebreak, '{{<br>}}');
            }
            header.addNode(new Tnode({type: 'th', isSpan: true}, new Tnode({
              type: '_fragment_',
              text: text
            })));
          }
        }
        newNode.addNode(new Tnode({type: 'thead'}, header));
      }
      var body = new Tnode({type: 'tbody'}, true);
      for (var i = 0, m = rows.length; i < m; i++) {
        row = rows[i];
        var tableRow = new Tnode({type: 'tr'}, true);
        for (var j = 0, n = row.length; j < n; j++) {
          text = helpers.trim(row[j]);
          if (linebreak) {
            text = text.replace(linebreak, '{{<br>}}');
          }
          tableRow.addNode(new Tnode({
            type: ((j === 0) && headerFlags[1]) ? 'th' : 'td',
            isSpan: true
          }, new Tnode({
            type: '_fragment_',
            text: text
          })));
        }
        body.addNode(tableRow);
      }
      newNode.addNode(body);
      node.parentNode.replaceNode(node, newNode);
    //},
    ///**
    // * Display some math!
    // * Syntax:
    // *   .. math{latex}
    // *      your equations
    // */
    //math: function (node, root, helpers) {
    //  var format = node.args;
    //  node.text = helpers.ltrimTextBlock(node.text);
    //  if (format === 'latex') {
    //    var opts = node.opts;
    //    var className = opts.class;
    //    if (className) {
    //      className = className.split(/[ \t\f]+/);
    //    }
    //    var preview = new helpers.Tnode({
    //      type: 'pre',
    //        $id: opts.id,
    //        $class: helpers.mergeClasses('MathJax_Preview', className),
    //        $style: opts.style,
    //        $title: opts.title,
    //        text: node.text
    //    });
    //    var newNode = new helpers.Tnode({
    //      type: 'script',
    //        $type: 'math/tex; mode=display',
    //        text: node.text
    //    });
    //    node.parentNode.replaceNode(node, new helpers.Tnode({
    //      type: '_fragment_',
    //    }, [preview, newNode]));
    //  } else {
    //    node.parentNode.removeNode(node);
    //  }
    }
  },

  // after inline-lexing
  after: {
    /**
     * Adds a link address to the text.
     * Syntax:
     *   .. link{name} URI
     */
    link: function (node, root, helpers) {
      node.parentNode.removeNode(node);
      node.text = helpers.ltrimTextBlock(node.text);
      var defName = node.args.toLowerCase();
      var defLink = node.text;
      if (!defLink || !defName) {
        return;
      }
      var opts = node.opts;
      root.traverse(function (node) {
        if (node.type !== 'i_link') {
          return;
        }
        if (node.link) {
          var matches = /^\{(.+)\}$/.exec(node.link);
          if (!matches || (matches[1].toLowerCase() !== defName)) {
            return;
          }
        } else {
          if (node.text.toLowerCase() !== defName) {
            return;
          }
        }
        node.link = defLink;
        if (opts.id) {
          node.$id = opts.id;
          opts.id = null;
        }
        if (opts.class) {
          var className = opts.class;
          if (className) {
            className = className.split(/[ \t\f]+/);
          }
          node.$class = node.$class ?
              helpers.mergeClasses(node.$class, className) : className;
        }
        if (opts.style) {
          node.$style += (node.$style ? ';' : '') + opts.style;
        }
        if (opts.title) {
          nodes.$title = opts.title;
        }
      });
    },
    /**
     * Replaces a pipe with an image.
     * Syntax:
     *   .. pipe-image{name} URI
     *      :format: format
     *      :option of image directive: value
     */
    'pipe-image': function (node, root, helpers) {
      node.parentNode.removeNode(node);
      var defName = node.args;
      var defText = helpers.ltrimTextBlock(node.text);
      if (!defName || !defText) {
        return;
      }
      var opts = node.opts;
      opts.simple = 'true';
      root.traverse(function (node) {
        if ((node.type !== 'i_pipe') || (node.name !== defName)) {
          return;
        }
        node.args = opts.format || '';
        node.opts = opts;
        node.text = defText;
        helpers.options.directives.immediate.image(node, root, helpers);
      });
    },
    /**
     * Transform a pipe into text and adds title to it.
     * Syntax:
     *   .. pipe-abbr{name} title
     */
    'pipe-abbr': function (node, root, helpers) {
      node.parentNode.removeNode(node);
      var defName = node.args;
      var defText = helpers.ltrimTextBlock(node.text);
      if (!defName || !defText) {
        return;
      }
      var opts = node.opts;
      var className = opts.class;
      if (className) {
        className = className.split(/[ \t\f]+/);
      }
      root.traverse(function (node) {
        if ((node.type !== 'i_pipe') || (node.name !== defName)) {
          return;
        }
        var newNode = new helpers.Tnode({
          type: 'abbr',
          isSpan: true,
          text: defName,
          $title: opts.title || defText,
          $id: opts.id,
          $class: className,
          $style: opts.style
        });
        node.parentNode.replaceNode(node, newNode);
      });
    },
    /**
     * Replaces a pipe with some text.
     * Syntax:
     *   .. pipe-text{} text
     *      :format: raw (inserted as raw HTML code? defaut:)
     */
    'pipe-text': function (node, root, helpers) {
      node.parentNode.removeNode(node);
      var defName = node.args;
      var defText = helpers.ltrimTextBlock(node.text);
      if (!defName || !defText) {
        return;
      }
      var opts = node.opts;
      var format = (opts.format === 'raw') ? 'i_raw' : 'i_text';
      root.traverse(function (node) {
        if ((node.type !== 'i_pipe') || (node.name !== defName)) {
          return;
        }
        var newNode = new helpers.Tnode({
          type: format,
          text: defText
        });
        node.parentNode.replaceNode(node, newNode);
      });
    },
    /**
     * Inserts a table of contents.
     * It must works with directive "#section".
     * Syntax:
     *   .. contents{Caption}
     *      :depth: 3 (1-6, default: 3)
     */
    contents: function (node, root, helpers) {
      var Tnode = helpers.Tnode;
      var caption = node.args;
      var opts = node.opts;
      var className = opts.class;
      if (className) {
        className = className.split(/[ \t\f]+/);
      }
      var depth = parseInt(opts.depth, 10);
      depth = ((depth >= 1) && (depth <= 6)) ? depth : 3;
      var newNode = new Tnode({
        type: 'div',
        $id: opts.id || 'kaj-contents',
        $class: className,
        $style: opts.style,
        $title: opts.title
      }, true);
      if (caption) {
        newNode.addNode(
          new Tnode({
            type: 'div',
            $class: 'kaj-contents-title'
          }, new Tnode({type: 'span', isSpan: true, text: caption}))
        );
      }
      var listNode = new Tnode({type: 'ul'}, true);
      root.traverse(function (node) {
        if (node === root) { return; }  // avoids infinite recursion
        if (node.type !== 'b_section') { return true; }
        if (node.size > depth) { return false; }  // stops breadth-first-search
        var section = node;
        if (!section.id) { return true; }
        var size = section.size;
        var heading = section.getNthNode(1);
        if (heading.type !== 'b_heading') {
          heading = {};
        }
        heading.link = '#kaj-contents';
        var indexes = section.id.replace(/^kaj-section-/, '').
            split('-', size).
            map(function (n) {
              return parseInt(n, 10);
            });
        var paren = listNode.getNthNode(indexes[0]);
        if (!paren) {
          paren = new Tnode({type: 'li'}, new Tnode({
            type: 'a',
            isSpan: true,
            $href: '#' + section.id,
            text: heading.text
          }));
          listNode.addNode(paren);
        }
        var child;
        for (var i = 1, l = indexes.length; i < l; i++) {
          if (!(child = paren.getNthNode(2))) {
            child = new Tnode({type: 'ul'}, true);
            paren.addNode(child);
          }
          paren = child;
          if (!(child = paren.getNthNode(indexes[i]))) {
            child = new Tnode({type: 'li'}, new Tnode({
              type: 'a',
              isSpan: true,
              $href: '#' + section.id,
              text: heading.text
            }));
            paren.addNode(child);
          }
          paren = child;
        }
      }, true);
      if (listNode.childNodes.length) {
        newNode.addNode(listNode);
        node.parentNode.replaceNode(node, newNode);
      } else {
        node.parentNode.removeNode(node);
      }
    }
  }

};

},{}],10:[function(require,module,exports){
var throwError = function (msg) {
  var errmsg = 'SyntaxError: ' + msg + '\n';
  throw new Error(errmsg);
};

var trim = function (s) {
  // http://www.w3.org/html/wg/drafts/html/master/infrastructure.html#space-character
  // [ \t\n\f\r] - [\n\r]
  return s.replace(/^[ \t\f]+|[ \t\f]+$/g, '');
};

var ltrimTextBlock = function (text) {
  return text.replace(/^(?: *\n)+/, '');
};

var rtrimTextBlock = function (text) {
  return text.replace(/(?:\n *)+$/, '');
};

var parseOptions = function (text) {
  var opts = {};
  var lines = text.split('\n');
  var i = 0;
  for (var line; line = lines[i]; i++) {
    var matches = /^:([^:][^:]*):(.*)$/.exec(line);
    if (!matches) {
      break;
    }
    var key = matches[1];
    var value = trim(matches[2]);
    opts[key] = value;
  }
  return {
    options: opts,
    optionText: lines.slice(0, i).join('\n'),
    normalText: lines.slice(i).join('\n')
  };
};

var pad = function (n) {
  var s = '';
  var c = '';
  while (n > 0) {
    c += (c || ' ');
    if ((n & 0x1) === 0x1) { s += c; }
    n >>>= 1;
  }
  return s;
};

var getIndent = function (line) {
  var index = line.search(/[^ ]/);
  if (index < 0) {
    return false;
  }
  return index;
};

var mergeClasses = function () {
  var classes = [].slice.call(arguments);
  var result = [];
  for (var i = 0, l = classes.length; i < l; i++) {
    result = result.concat(classes[i]);
  }
  return result;
};

module.exports = {
  throwError: throwError,
  trim: trim,
  ltrimTextBlock: ltrimTextBlock,
  rtrimTextBlock: rtrimTextBlock,
  parseOptions: parseOptions,
  mergeClasses: mergeClasses,
  getIndent: getIndent,
  pad: pad
};

},{}],11:[function(require,module,exports){
module.exports = {

  /**
   * helpers = {
   *   options: kaj.options,
   *   Tnode: kaj.Tnode,
   *   BlockLexer: kaj.BlockLexer,
   *   InlineLexer: kaj.InlineLexer,
   *   renderer: (renderer),
   *   Renderer: kaj.Renderer,
   *   ltrimTextBlock: ltrimTextBlock,
   *   rtrimTextBlock: rtrimTextBlock,
   *   mergeClasses: mergeClasses,
   *   parseOptions: parseOptions,
   *   throwError: throwError,
   *   getIndent: getIndent,
   *   trim: trim,
   *   pad: pad
   * }
   */
  general: function (node, root, helpers) {
    return helpers.Renderer.getSpan('span', {
      id: node.$id,
      class: helpers.mergeClasses('kaj-general', node.$class),
      style: node.$style,
      title: node.$title
    }, helpers.trim(node.text));
  //},

  //email: function (node, root, helpers) {
  //  return helpers.Renderer.getSpan('span', {
  //    id: node.$id,
  //    class: helpers.mergeClasses('kaj-role-email', node.$class),
  //    style: (node.$style ? (node.$style + ';') : '') +
  //        'unicode-bidi:bidi-override;direction:rtl',
  //    title: node.$title
  //  }, helpers.trim(node.text).split('').reverse().join(''));
  //},
  //ruby: function (node, root, helpers) {
  //  var index = node.text.indexOf('~');
  //  var Renderer = helpers.Renderer;
  //  if (index >= 0) {
  //    return Renderer.getSpan('ruby', {
  //      id: node.$id,
  //      class: node.$class,
  //      style: node.$style,
  //      title: node.$title
  //    }, Renderer.escape(helpers.trim(node.text.substr(0, index))) +
  //        Renderer.getSpan('rp', '（') +
  //        Renderer.getSpan('rt', helpers.trim(node.text.substr(index + 1))) +
  //        Renderer.getSpan('rp', '）'),
  //    false, true);
  //  } else {
  //    return Renderer.getSpan('ruby', helpers.trim(node.text));
  //  }
  //},
  //latex: function (node, root, helpers) {
  //    var preview = helpers.Renderer.getSpan('span', {
  //      type: 'code',
  //      id: node.$id,
  //      class: helpers.mergeClasses('MathJax_Preview', node.$class),
  //      style: node.$style,
  //      title: node.$title
  //    }, node.text);
  //    return preview + helpers.Renderer.getSpan('script', {
  //      type: 'math/tex',
  //      class: 'kaj-role-latex'
  //    }, node.text);
  //  });
  }

};

},{}],12:[function(require,module,exports){
(function (global,Buffer){
'use strict';

var clone = (function(global) {

/**
 * Clones (copies) an Object using deep copying.
 *
 * This function supports circular references by default, but if you are certain
 * there are no circular references in your object, you can save some CPU time
 * by calling clone(obj, false).
 *
 * Caution: if `circular` is false and `parent` contains circular references,
 * your program may enter an infinite loop and crash.
 *
 * @param `parent` - the object to be cloned
 * @param `circular` - set to true if the object to be cloned may contain
 *    circular references. (optional - true by default)
 * @param `depth` - set to a number if the object is only to be cloned to
 *    a particular depth. (optional - defaults to Infinity)
 * @param `prototype` - sets the prototype to be used when cloning an object.
 *    (optional - defaults to parent prototype).
*/

function clone(parent, circular, depth, prototype) {
  var filter;
  if (typeof circular === 'object') {
    depth = circular.depth;
    prototype = circular.prototype;
    filter = circular.filter;
    circular = circular.circular
  }
  // maintain two arrays for circular references, where corresponding parents
  // and children have the same index
  var allParents = [];
  var allChildren = [];

  var useBuffer = typeof Buffer != 'undefined';

  if (typeof circular == 'undefined')
    circular = true;

  if (typeof depth == 'undefined')
    depth = Infinity;

  // recurse this function so we don't reset allParents and allChildren
  function _clone(parent, depth) {
    // cloning null always returns null
    if (parent === null)
      return null;

    if (depth == 0)
      return parent;

    var child;
    var proto;
    if (typeof parent != 'object') {
      return parent;
    }

    if (isArray(parent)) {
      child = [];
    } else if (isRegExp(parent)) {
      child = new RegExp(parent.source, clone.getRegExpFlags(parent));
      if (parent.lastIndex) child.lastIndex = parent.lastIndex;
    } else if (isDate(parent)) {
      child = new Date(parent.getTime());
    } else if (useBuffer && Buffer.isBuffer(parent)) {
      child = new Buffer(parent.length);
      parent.copy(child);
      return child;
    } else {
      if (typeof prototype == 'undefined') {
        proto = Object.getPrototypeOf(parent);
        child = Object.create(proto);
      }
      else {
        child = Object.create(prototype);
        proto = prototype;
      }
    }

    if (circular) {
      var index = allParents.indexOf(parent);

      if (index != -1) {
        return allChildren[index];
      }
      allParents.push(parent);
      allChildren.push(child);
    }

    for (var i in parent) {
      var attrs;
      if (proto) {
        attrs = Object.getOwnPropertyDescriptor(proto, i);
      }
      
      if (attrs && attrs.set == null) {
        continue;
      }
      child[i] = _clone(parent[i], depth - 1);
    }

    return child;
  }

  return _clone(parent, depth);
}

/**
 * Simple flat clone using prototype, accepts only objects, usefull for property
 * override on FLAT configuration object (no nested props).
 *
 * USE WITH CAUTION! This may not behave as you wish if you do not know how this
 * works.
 */
clone.clonePrototype = function(parent) {
  if (parent === null)
    return null;

  var c = function () {};
  c.prototype = parent;
  return new c();
};

function getRegExpFlags(re) {
  var flags = '';
  re.global && (flags += 'g');
  re.ignoreCase && (flags += 'i');
  re.multiline && (flags += 'm');
  return flags;
}

function objectToString(o) {
  return Object.prototype.toString.call(o);
}

function isDate(o) {
  return typeof o === 'object' && objectToString(o) === '[object Date]';
}

function isArray(o) {
  return typeof o === 'object' && objectToString(o) === '[object Array]';
}

function isRegExp(o) {
  return typeof o === 'object' && objectToString(o) === '[object RegExp]';
}

if (global.TESTING) clone.getRegExpFlags = getRegExpFlags;
if (global.TESTING) clone.objectToString = objectToString;
if (global.TESTING) clone.isDate   = isDate;
if (global.TESTING) clone.isArray  = isArray;
if (global.TESTING) clone.isRegExp = isRegExp;

return clone;

})( typeof(global) === 'object' ? global :
    typeof(window) === 'object' ? window : this);

if (module && module.exports)
  module.exports = clone;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"buffer":1}],13:[function(require,module,exports){
var hasOwn = Object.prototype.hasOwnProperty;
var toString = Object.prototype.toString;
var undefined;

var isPlainObject = function isPlainObject(obj) {
	'use strict';
	if (!obj || toString.call(obj) !== '[object Object]') {
		return false;
	}

	var has_own_constructor = hasOwn.call(obj, 'constructor');
	var has_is_property_of_method = obj.constructor && obj.constructor.prototype && hasOwn.call(obj.constructor.prototype, 'isPrototypeOf');
	// Not own constructor property must be Object
	if (obj.constructor && !has_own_constructor && !has_is_property_of_method) {
		return false;
	}

	// Own properties are enumerated firstly, so to speed up,
	// if last one is own, then all properties are own.
	var key;
	for (key in obj) {}

	return key === undefined || hasOwn.call(obj, key);
};

module.exports = function extend() {
	'use strict';
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[0],
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if (typeof target === 'boolean') {
		deep = target;
		target = arguments[1] || {};
		// skip the boolean and the target
		i = 2;
	} else if ((typeof target !== 'object' && typeof target !== 'function') || target == null) {
		target = {};
	}

	for (; i < length; ++i) {
		options = arguments[i];
		// Only deal with non-null/undefined values
		if (options != null) {
			// Extend the base object
			for (name in options) {
				src = target[name];
				copy = options[name];

				// Prevent never-ending loop
				if (target === copy) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if (deep && copy && (isPlainObject(copy) || (copyIsArray = Array.isArray(copy)))) {
					if (copyIsArray) {
						copyIsArray = false;
						clone = src && Array.isArray(src) ? src : [];
					} else {
						clone = src && isPlainObject(src) ? src : {};
					}

					// Never move original objects, clone them
					target[name] = extend(deep, clone, copy);

				// Don't bring in undefined values
				} else if (copy !== undefined) {
					target[name] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};


},{}],14:[function(require,module,exports){
// TODO: add syntax checker

var clone = require('clone');
var extend = require('extend');
var roles = require('./utils/roles.js');
var directives = require('./utils/directives.js');
var Renderer = require('./utils/class-renderer.js');
var BlockLexer = require('./utils/class-blocklexer.js');
var InlineLexer = require('./utils/class-inlinelexer.js');
var Tnode = require('./utils/class-tnode.js');

var kaj = function (src, opts) {
  var options = clone(opts ? opts : kaj.options);
  return Renderer.render(BlockLexer.lex(src, options), options);
};
kaj.lex = function (src, opts) {
  var options = opts ? opts : clone(kaj.options);
  return BlockLexer.lex(src, options);
};
kaj.render = function (ast, opts) {
  var options = opts ? opts : clone(kaj.options);
  return Renderer.render(ast, options);
};

kaj.InlineLexer = InlineLexer;
kaj.BlockLexer = BlockLexer;
kaj.Renderer = Renderer;
kaj.Tnode = Tnode;

kaj.setDirective = function (queue, name, callback) {
  if (!name || /^[ \t\f\{]|[ \t\f]$/.test(name || '')) {
    throw new Error('Directive name is invalid.');
  }
  var type = typeof callback;
  var queue = kaj.options.directives[queue];
  if (type === 'string') {
    queue[name] = queue[callback];  // alias
  } else if (type === 'function') {
    queue[name] = callback;
  } else {
    delete queue[name];
  }
};
kaj.setRole = function (name, callback) {
  if (!name || /^[ \t\f~]|[ \t\f~]$/.test(name || '')) {
    throw new Error('Role name is invalid.');
  }
  var type = typeof callback;
  if (type === 'string') {
    kaj.options.roles[name] = kaj.options.roles[callback];  // alias
  } else if (type === 'function') {
    kaj.options.roles[name] = callback;
  } else {
    delete kaj.options.roles[name];
  }
};

kaj.options = {
  directives: directives,
  roles: roles,
  highlight: null,
  cwd: './'
};

var noop_directive = function (node, root, helpers) {
  node.parentNode.remove(node);
};
kaj.setDirective('immediate', '@include', noop_directive);
kaj.setDirective('immediate', '@embed', noop_directive);

window.kaj = kaj;

},{"./utils/class-blocklexer.js":5,"./utils/class-inlinelexer.js":6,"./utils/class-renderer.js":7,"./utils/class-tnode.js":8,"./utils/directives.js":9,"./utils/roles.js":11,"clone":12,"extend":13}]},{},[14]);
