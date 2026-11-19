// Faster SSH key exchange: BigInteger.modPow (the old jsbn library inside
// paramikojs_ssh.min.js) done with the browser's own BigInt.
//
// Logging in over SSH does two 4096-bit modular powers (PTT's server picks a
// 4096-bit group for diffie-hellman-group-exchange). jsbn took 0.4-1.3 s for
// each, BigInt about 60 ms: the login screen came seconds later than it needed
// to. Same results; jsbn is kept for what BigInt can't do (no BigInt, negative
// numbers, modulus <= 0).
/* global BigInteger, BigInt */
var FastModPow = {
  toBig: function(b) {
    return BigInt('0x' + b.toString(16));
  },
  fromBig: function(n) {
    return new BigInteger(n.toString(16), 16);
  },
  // base^exp mod m on BigInts (base, exp >= 0, m > 0), 4 bits of exp at a time
  pow: function(base, exp, m) {
    var one = BigInt(1);
    if (m === one) return BigInt(0);
    base = base % m;
    var table = [one % m, base];
    for (var i = 2; i < 16; ++i) table.push(table[i - 1] * base % m);
    var hex = exp.toString(16);
    var r = table[0];
    for (var j = 0; j < hex.length; ++j) {
      if (j > 0) {
        r = r * r % m; r = r * r % m; r = r * r % m; r = r * r % m;
      }
      var d = parseInt(hex.charAt(j), 16);
      if (d) r = r * table[d] % m;
    }
    return r;
  },
  install: function(BigIntegerCtor) {
    if (typeof BigInt !== 'function' || !BigIntegerCtor || !BigIntegerCtor.prototype.modPow) return false;
    var proto = BigIntegerCtor.prototype;
    if (proto.modPow.jsbn) return true;  // already installed
    var jsbn = proto.modPow;
    proto.modPow = function(e, m) {
      if (this.signum() < 0 || e.signum() < 0 || m.signum() <= 0) {
        return jsbn.call(this, e, m);
      }
      return FastModPow.fromBig(FastModPow.pow(FastModPow.toBig(this), FastModPow.toBig(e), FastModPow.toBig(m)));
    };
    proto.modPow.jsbn = jsbn;
    return true;
  }
};

if (typeof BigInteger === 'function') FastModPow.install(BigInteger);
