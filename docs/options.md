## corm\.enable

Whether to enable Corm\.

_Type:_ boolean

_Default:_

```nix
false
```

_Example:_

```nix
true
```

## corm\.cpu-provider\.enable

Whether to enable Corm CPU provider\.

_Type:_ boolean

_Default:_

```nix
false
```

_Example:_

```nix
true
```

## corm\.cpu-provider\.ctx

Context size to allocate KV cache for\.

_Type:_ unsigned integer, meaning >=0

_Default:_

```nix
131072
```

## corm\.cpu-provider\.host

Binding host for the CPU provider service\.

_Type:_ string

_Default:_

```nix
"127.0.0.1"
```

## corm\.cpu-provider\.kind

Backend to run the CPU provider with\.

_Type:_ attribute-tagged union with choices: llama-cpp

_Default:_

```nix
{
  llama-cpp = { };
}
```

## corm\.cpu-provider\.kind\.llama-cpp

Run the provider with llama\.cpp\.

_Type:_ submodule

## corm\.cpu-provider\.kind\.llama-cpp\.package

llama\.cpp package to use\.

_Type:_ package

_Default:_

```nix
<derivation llama-cpp-9190>
```

## corm\.cpu-provider\.kind\.llama-cpp\.quant

llama-quantize output type to quantize the converted checkpoint to\.

_Type:_ string

_Default:_

```nix
"Q4_K_M"
```

## corm\.cpu-provider\.kind\.llama-cpp\.ubatch

–ubatch-size for llama\.cpp to use\.

_Type:_ unsigned integer, meaning >=0

_Default:_

```nix
2048
```

## corm\.cpu-provider\.mmproj

Export and serve the multimodal projector from the checkpoint\.

_Type:_ boolean

_Default:_

```nix
true
```

## corm\.cpu-provider\.model

HuggingFace checkpoint to convert and run\.

_Type:_ package

_Default:_

```nix
<derivation gemma-4-e4b>
```

## corm\.cpu-provider\.port

Binding port for the CPU provider service\.

_Type:_ 16 bit unsigned integer; between 0 and 65535 (both inclusive)

_Default:_

```nix
43372
```

## corm\.embedding\.enable

Whether to enable Corm embedding provider\.

_Type:_ boolean

_Default:_

```nix
false
```

_Example:_

```nix
true
```

## corm\.embedding\.ctx

Context size to allocate KV cache for\.

_Type:_ unsigned integer, meaning >=0

_Default:_

```nix
32768
```

## corm\.embedding\.host

Binding host for the embedding service\.

_Type:_ string

_Default:_

```nix
"127.0.0.1"
```

## corm\.embedding\.kind

Backend to run the embedding provider with\.

_Type:_ attribute-tagged union with choices: llama-cpp

_Default:_

```nix
{
  llama-cpp = { };
}
```

## corm\.embedding\.kind\.llama-cpp

Run the provider with llama\.cpp\.

_Type:_ submodule

## corm\.embedding\.kind\.llama-cpp\.package

llama\.cpp package to use\.

_Type:_ package

_Default:_

```nix
<derivation llama-cpp-9190>
```

## corm\.embedding\.kind\.llama-cpp\.quant

llama-quantize output type to quantize the converted checkpoint to\.

_Type:_ string

_Default:_

```nix
"Q8_0"
```

## corm\.embedding\.kind\.llama-cpp\.ubatch

–ubatch-size for llama\.cpp to use\.

_Type:_ unsigned integer, meaning >=0

_Default:_

```nix
2048
```

## corm\.embedding\.model

HuggingFace checkpoint to convert and run\.

_Type:_ package

_Default:_

```nix
<derivation qwen-3-embedding>
```

## corm\.embedding\.port

Binding port for the embedding service\.

_Type:_ 16 bit unsigned integer; between 0 and 65535 (both inclusive)

_Default:_

```nix
43374
```

## corm\.endpoint\.enable

Whether to enable Corm endpoint\.

_Type:_ boolean

_Default:_

```nix
false
```

_Example:_

```nix
true
```

## corm\.endpoint\.client\.enable

Install the aichat client, pointed at the Corm endpoint\.

_Type:_ boolean

_Default:_

```nix
config.corm.endpoint.enable
```

## corm\.endpoint\.host

Host to listen on

_Type:_ string

_Default:_

```nix
"127.0.0.1"
```

## corm\.endpoint\.model

The endpoint model name clients request\. Defaults to the configured agent
name\.

_Type:_ string

_Default:_

```nix
config.corm.omw.agent
```

## corm\.endpoint\.port

Port to listen on

_Type:_ 16 bit unsigned integer; between 0 and 65535 (both inclusive)

_Default:_

```nix
43371
```

## corm\.gpu-provider\.enable

Whether to enable Corm GPU provider\.

_Type:_ boolean

_Default:_

```nix
false
```

_Example:_

```nix
true
```

## corm\.gpu-provider\.ctx

Context size to allocate KV cache for\.

_Type:_ unsigned integer, meaning >=0

_Default:_

```nix
196608
```

## corm\.gpu-provider\.host

Binding host for the GPU provider service\.

_Type:_ string

_Default:_

```nix
"127.0.0.1"
```

## corm\.gpu-provider\.kind

Which GPU provider kind to run\.

_Type:_ attribute-tagged union with choices: freetoken, llama-cpp, strata

_Default:_

```nix
{
  llama-cpp = { };
}
```

## corm\.gpu-provider\.kind\.freetoken

FreeToken GPU provider\.

_Type:_ submodule

_Default:_

```nix
{ }
```

## corm\.gpu-provider\.kind\.freetoken\.package

FreeToken engine package to use\.

_Type:_ package

_Default:_

```nix
<derivation freetoken-0.1.3>
```

## corm\.gpu-provider\.kind\.freetoken\.extraArgs

Extra arguments passed to `ft serve`\.

_Type:_ list of string

_Default:_

```nix
[ ]
```

## corm\.gpu-provider\.kind\.freetoken\.gpu

–gpu (an nvidia-smi index or UUID) for the engine to use\.

_Type:_ null or string

_Default:_

```nix
null
```

## corm\.gpu-provider\.kind\.freetoken\.memoryRatio

–memory-ratio for the engine to use\.

_Type:_ floating point number

_Default:_

```nix
0.9
```

## corm\.gpu-provider\.kind\.freetoken\.moeCacheSize

–moe-cache-size (in expert slots) for the engine to use\.

_Type:_ null or (unsigned integer, meaning >=0)

_Default:_

```nix
null
```

## corm\.gpu-provider\.kind\.freetoken\.moeStrategy

–moe-strategy for the engine to use\.

_Type:_ null or one of “fused”, “offload”, “cpu”, “hybrid”

_Default:_

```nix
null
```

## corm\.gpu-provider\.kind\.llama-cpp

llama\.cpp GPU provider\.

_Type:_ submodule

_Default:_

```nix
{ }
```

## corm\.gpu-provider\.kind\.llama-cpp\.package

llama\.cpp package to use\.

_Type:_ package

_Default:_

```nix
<derivation llama-cpp-10362>
```

## corm\.gpu-provider\.kind\.llama-cpp\.fate

–fate-cache for llama\.cpp to use\. Only used with the FATE MoE cache llama\.cpp
package\.

_Type:_ unsigned integer, meaning >=0

_Default:_

```nix
4096
```

## corm\.gpu-provider\.kind\.llama-cpp\.quant

llama-quantize output type to quantize the converted checkpoint to\.

_Type:_ string

_Default:_

```nix
"Q4_K_M"
```

## corm\.gpu-provider\.kind\.llama-cpp\.ubatch

–ubatch-size for llama\.cpp to use\.

_Type:_ unsigned integer, meaning >=0

_Default:_

```nix
2048
```

## corm\.gpu-provider\.kind\.strata

Strata GPU provider (Qwen3\.8-Flash-Next IQ2_XS)\.

_Type:_ submodule

_Default:_

```nix
{ }
```

## corm\.gpu-provider\.kind\.strata\.package

Strata server package to use\.

_Type:_ package

_Default:_

```nix
<derivation strata-0.1.38>
```

## corm\.gpu-provider\.kind\.strata\.cudaArchitectures

CUDA compute capabilities to compile the engine for\. Read your card’s with
`nvidia-smi --query-gpu=compute_cap --format=csv` (e\.g\. 8\.6 for an RTX 3060),
then use it without the dot (“86”)\.

_Type:_ list of string

_Default:_

```nix
[
  "75"
  "80"
  "86"
  "89"
  "120"
]
```

## corm\.gpu-provider\.kind\.strata\.extraArgs

Extra arguments passed to the Strata engine\.

_Type:_ list of string

_Default:_

```nix
[ ]
```

## corm\.gpu-provider\.kind\.strata\.gpu

Optional GPU index or UUID for the engine (`--gpu`)\.

_Type:_ null or string

_Default:_

```nix
null
```

## corm\.gpu-provider\.kind\.strata\.kv

KV cache type for contexts above 8192\.

_Type:_ one of “fp16”, “int8”

_Default:_

```nix
"int8"
```

## corm\.gpu-provider\.kind\.strata\.march

Optional `-march` level for the CPU code (e\.g\. `x86-64-v3`, `znver4`); empty
keeps the portable baseline\.

_Type:_ string

_Default:_

```nix
""
```

## corm\.gpu-provider\.kind\.strata\.portable

Build ggml for a portable AVX2 baseline instead of the build machine’s native
CPU, keeping the build deterministic and substitutable\.

_Type:_ boolean

_Default:_

```nix
true
```

## corm\.gpu-provider\.kind\.strata\.prefill

Prompt prefill chunk size (`--prefill`)\.

_Type:_ string

_Default:_

```nix
"auto"
```

## corm\.gpu-provider\.kind\.strata\.spec

MTP speculative draft tokens (`--spec`)\.

_Type:_ unsigned integer, meaning >=0

_Default:_

```nix
4
```

## corm\.gpu-provider\.kind\.strata\.specMinP

Minimum draft acceptance probability (`--spec-min-p`)\.

_Type:_ floating point number

_Default:_

```nix
0.5
```

## corm\.gpu-provider\.kind\.strata\.vision

Run the multimodal image encoder on the GPU, on the CPU, or not at all\.

_Type:_ one of “none”, “gpu”, “cpu”

_Default:_

```nix
"none"
```

## corm\.gpu-provider\.kind\.strata\.visionReserveMib

VRAM (MiB) to keep free for the image encoder when vision is enabled\.

_Type:_ unsigned integer, meaning >=0

_Default:_

```nix
1500
```

## corm\.gpu-provider\.model

HuggingFace checkpoint to convert and run\.

_Type:_ package

_Default:_

```nix
<derivation occamy>
```

## corm\.gpu-provider\.port

Binding port for the GPU provider service\.

_Type:_ 16 bit unsigned integer; between 0 and 65535 (both inclusive)

_Default:_

```nix
43373
```

## corm\.omw\.enable

Whether to enable the Corm omw agent runtime\.

_Type:_ boolean

_Default:_

```nix
false
```

_Example:_

```nix
true
```

## corm\.omw\.agent

The name of the agent the brain runs as\. This is also the endpoint model name
the agent subscribes under\.

_Type:_ string

_Default:_

```nix
"corm"
```

## corm\.omw\.bwrapArgs

Extra bubblewrap arguments passed to the bubblewrap MCP servers\. Null keeps the
platform defaults (selfLib\.bwrap\.base); containers use
selfLib\.bwrap\.container\.

_Type:_ null or (list of string)

_Default:_

```nix
null
```

## corm\.omw\.environment

Environment variables for the service\.

_Type:_ attribute set of string

_Default:_

```nix
{ }
```

## corm\.omw\.environmentFile

Path to a systemd EnvironmentFile for the service\.

_Type:_ null or absolute path

_Default:_

```nix
null
```

## corm\.omw\.memory

Extra memory keys seeded into the agent’s memory before its brain first runs\.

_Type:_ attribute set of string

_Default:_

```nix
{ }
```

## corm\.omw\.mode

Run the script once or loop\.

_Type:_ one of “run”, “loop”

_Default:_

```nix
"loop"
```

## corm\.omw\.script

The JavaScript brain script omw runs\.

_Type:_ absolute path

_Default:_

```nix
"/nix/store/ggp8a3fjn7x3k95y087pvbl07q7h21za-corm-0.1.0/index.js"
```

## corm\.omw\.tunables

Extra tunables to pass to omw\.

_Type:_ attribute set of raw value

_Default:_

```nix
{ }
```

## corm\.omw\.variant

Which omw runtime variant to run\.

_Type:_ one of “default”, “rhai”, “js”

_Default:_

```nix
"js"
```

## corm\.remote-provider\.enable

Whether to enable Corm remote provider\.

_Type:_ boolean

_Default:_

```nix
false
```

_Example:_

```nix
true
```

## corm\.remote-provider\.baseUrl

Corm remote provider OpenAI API base url

_Type:_ string

_Default:_

```nix
"https://openrouter.ai/api/v1"
```

## corm\.remote-provider\.model

Corm remote provider OpenAI API model

_Type:_ string

_Default:_

```nix
"deepseek/deepseek-v4.1-flash"
```

## corm\.settings

Corm settings passed to the agent through it’s memory\.

_Type:_ JSON value

_Default:_

```nix
{ }
```
