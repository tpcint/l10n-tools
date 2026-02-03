import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FormatNotFoundError,
  NoOrdinalFormatError,
  TagNotFoundError,
  UnexpectedFormatError,
  UnexpectedTagError,
  validateMsg,
} from './validator.js'

describe('validate message', () => {
  it('C string format', () => {
    assert.doesNotThrow(() => validateMsg('Hello %s', '안녕 %s'))
    assert.throws(() => validateMsg('Hello %s', '안녕'), FormatNotFoundError)
    assert.throws(() => validateMsg('Hello', '안녕 %s'), UnexpectedFormatError)
    assert.throws(() => validateMsg('Hello %s', '안녕 %d'), FormatNotFoundError)
    assert.throws(() => validateMsg('Hello %.2f', '안녕 %.1f'), FormatNotFoundError)
    assert.throws(() => validateMsg('Hello %s, %f', '안녕 %s, %f'), NoOrdinalFormatError)
  })

  it('ordinal C string format', () => {
    assert.doesNotThrow(() => validateMsg('Hello %1$s', '안녕 %1$s'))
    assert.throws(() => validateMsg('Hello %1$s', '안녕'), FormatNotFoundError)
    assert.throws(() => validateMsg('Hello', '안녕 %1$s'), UnexpectedFormatError)
    assert.throws(() => validateMsg('Hello %1$s', '안녕 %1$d'), FormatNotFoundError)
    assert.throws(() => validateMsg('Hello %1$.2f', '안녕 %1$.1f'), FormatNotFoundError)
    assert.doesNotThrow(() => validateMsg('Hello %1$s, %2$f', '안녕 %1$s, %2$f'))
    assert.doesNotThrow(() => validateMsg('Hello %1$s, %2$f', '안녕 %2$f, %1$s'))
    assert.throws(() => validateMsg('Hello %1$s, %2$f', '안녕 %1$f, %2$s'), FormatNotFoundError)
  })

  it('single brace named format', () => {
    assert.doesNotThrow(() => validateMsg('Hello {}', '안녕 {}'))
    assert.doesNotThrow(() => validateMsg('Hello {0}', '안녕 {0}'))
    assert.doesNotThrow(() => validateMsg('Hello {name}', '안녕 {name}'))
    assert.throws(() => validateMsg('Hello {name}', '안녕'), FormatNotFoundError)
    assert.throws(() => validateMsg('Hello', '안녕 {name}'), UnexpectedFormatError)
    assert.throws(() => validateMsg('Hello {name}', '안녕 {username}'), FormatNotFoundError)
    assert.doesNotThrow(() => validateMsg('Hello {name}, {desc}', '안녕 {name}, {desc}'))
    assert.doesNotThrow(() => validateMsg('Hello {name}, {desc}', '안녕 {desc}, {name}'))
    assert.doesNotThrow(() => validateMsg('Hello {name}, {desc}', '안녕 {desc}, {name}, {name}'))
    assert.throws(() => validateMsg('Hello {name}, {desc}', '안녕 {name}, {name}'), FormatNotFoundError)
  })

  it('markup', () => {
    assert.doesNotThrow(() => validateMsg('Hello <b>{}</b>', '안녕 <b>{}</b>'))
    assert.doesNotThrow(() => validateMsg('Hello <div class="b">{0}</div>', '안녕 <div class="b">{0}</div>'))
    assert.doesNotThrow(() => validateMsg('Hello <div class = "b" >{name}</div >', '안녕 <div class= "b" >{name}</div >'))
    assert.throws(() => validateMsg('Hello <heart/>', '안녕'), TagNotFoundError)
    assert.throws(() => validateMsg('Hello', '안녕 <heart />'), UnexpectedTagError)
    assert.doesNotThrow(() => validateMsg('Hello <heart/>', '안녕 <heart />'))
    assert.throws(() => validateMsg('Hello <heart/>', '안녕 <hart/>'), TagNotFoundError)
    assert.doesNotThrow(() => validateMsg('Hello <b>{name}, <i>{desc}</i></b>', '안녕 <b>{name}, <i>{desc}</i></b>'))
    assert.doesNotThrow(() => validateMsg('Hello <b>{name}, <i>{desc}</i></b>', '안녕 <b><i>{desc}</i>, {name}</b>'))
    assert.throws(() => validateMsg('Hello <b>{name}, <i>{desc}</i></b>', '안녕 <b><i>{desc}</i>, {name}</b>, <b>{name}</b>'), UnexpectedTagError)
    assert.throws(() => validateMsg('Hello <b>{name}, <i>{desc}</i></b>', '안녕 <b>{name}</b>, <b>{desc}</b>'), TagNotFoundError)
    assert.doesNotThrow(() => validateMsg('Hello <b>{name}, <br><i>{desc}</i></b>', '안녕 <b>{name}, <br><i>{desc}</i></b>'))
    assert.throws(() => validateMsg('Hello <b>{name}, <i>{desc}</i></b>', '안녕 <b>{name}, <br><i>{desc}</i></b>'), UnexpectedTagError)
    assert.doesNotThrow(() => validateMsg('Hello <b>{name}, <br><i>{desc}</i></b>', '안녕 <b>{name}, <i>{desc}</i></b>'))
    assert.doesNotThrow(() => validateMsg('Hello <b>{name}, <br><i>{desc}</i></b>', '안녕 <b>{name}, <i>{desc}</i></b>'))
    assert.doesNotThrow(() => validateMsg('Hello <b>{name}, <br><i>{desc}</i></b>', '안녕 <b>{name}, <br><i>{desc}</i><br></b>'))
  })

  it('other cases', () => {
    assert.doesNotThrow(() => validateMsg(
      '헬로 \n{name}({certifiedName}, {phone})님이 {timestamp}어쩌고\n저쩌고 {name}님입니다.',
      'Hello\n\n{name}({certifiedName}, {phone}) has {timestamp}.\n {name} can be',
    ))
  })
})
