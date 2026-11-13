#!/usr/bin/env node
// Official get_site result via secure stdin only; never put tokens in argv/env.
import {probeIsolatedGateway} from '../sites/isolated-slow-probe.mjs';
let input='';
try {for await(const chunk of process.stdin){input+=chunk;if(input.length>100000)throw Error('input_too_large')}
 const {site,expectedSource}=JSON.parse(input);input='';
 console.log(JSON.stringify(await probeIsolatedGateway({site,expectedSource})));
} catch {console.error(JSON.stringify({status:'stopped',code:'slow_probe_unconfirmed',realGatewayFaultReproduced:false,collectionCancellationVerified:false}));process.exitCode=1} finally {input=''}
